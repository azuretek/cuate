#include <node.h>
#include <uv.h>
#include <v8.h>
#include <cstdio>
#include <map>
#include <memory>
#include <mutex>
#include <vector>
#include "bridge.h"
using namespace v8;
static decltype(node::InitializeOncePerProcess(std::vector<std::string>{})) init;
static std::unique_ptr<node::MultiIsolatePlatform> platform;
struct Reply { int32_t id, pid, main_thread; std::string payload; int error = 0; bool rpc = false; };
struct Pending { Global<Promise::Resolver> resolver; bool cancelled = false; };
struct Runtime {
  Isolate* isolate;
  Global<Context> context;
  uv_async_t async;
  std::map<int32_t, Pending> pending;
  std::mutex mutex;
  std::vector<Reply> replies;
};
static Runtime* runtime;
extern "C" int embed_init(int argc, char** argv) {
  std::vector<std::string> args(argv, argv + argc);
  init = node::InitializeOncePerProcess(args, {
    node::ProcessInitializationFlags::kNoInitializeV8,
    node::ProcessInitializationFlags::kNoInitializeNodeV8Platform
  });
  for (const auto& error : init->errors()) fprintf(stderr, "%s\n", error.c_str());
  if (init->early_return()) return init->exit_code();
  platform = node::MultiIsolatePlatform::Create(4);
  V8::InitializePlatform(platform.get()); V8::Initialize();
  return 0;
}
static void deliver(uv_async_t* handle) {
  auto* state = static_cast<Runtime*>(handle->data);
  Isolate* isolate = state->isolate;
  HandleScope handles(isolate);
  Local<Context> context = state->context.Get(isolate);
  Context::Scope scope(context);
  std::vector<Reply> replies;
  { std::lock_guard<std::mutex> lock(state->mutex); replies.swap(state->replies); }
  for (auto reply : replies) {
    auto found = state->pending.find(reply.id);
    if (found == state->pending.end()) continue;
    if (!found->second.cancelled) {
      Local<Object> value = Object::New(isolate);
      value->Set(context, String::NewFromUtf8Literal(isolate,"pid"), Integer::New(isolate,reply.pid)).Check();
      value->Set(context, String::NewFromUtf8Literal(isolate,"mainThread"), Boolean::New(isolate,reply.main_thread)).Check();
      if (reply.rpc) {
        auto payload = String::NewFromUtf8(isolate, reply.payload.c_str()).ToLocalChecked();
        if (reply.error) found->second.resolver.Get(isolate)->Reject(context, Exception::Error(payload)).Check();
        else found->second.resolver.Get(isolate)->Resolve(context, payload).Check();
      } else found->second.resolver.Get(isolate)->Resolve(context,value).Check();
    }
    found->second.resolver.Reset(); state->pending.erase(found);
  }
  if (state->pending.empty()) uv_unref(reinterpret_cast<uv_handle_t*>(&state->async));
}
extern "C" void native_complete(int32_t id, int32_t pid, int32_t main_thread) {
  { std::lock_guard<std::mutex> lock(runtime->mutex); runtime->replies.push_back({id,pid,main_thread}); }
  uv_async_send(&runtime->async);
}
extern "C" void native_rpc_complete(int32_t id, const char* payload, int32_t error) {
  { std::lock_guard<std::mutex> lock(runtime->mutex); runtime->replies.push_back({id,0,0,payload ? payload : "",error,true}); }
  uv_async_send(&runtime->async);
}
static void rpc_request(const FunctionCallbackInfo<Value>& info) {
  Isolate* isolate = info.GetIsolate(); auto context = isolate->GetCurrentContext();
  if (info.Length() != 3 || !info[0]->IsInt32() || !info[1]->IsString() || !info[2]->IsString()) {
    isolate->ThrowException(Exception::Error(String::NewFromUtf8Literal(isolate,"invalid rpc arguments"))); return;
  }
  int id = info[0].As<Int32>()->Value();
  if (runtime->pending.count(id)) { isolate->ThrowException(Exception::Error(String::NewFromUtf8Literal(isolate,"duplicate native id"))); return; }
  auto resolver = Promise::Resolver::New(context).ToLocalChecked(); runtime->pending[id].resolver.Reset(isolate,resolver);
  uv_ref(reinterpret_cast<uv_handle_t*>(&runtime->async));
  String::Utf8Value request(isolate,info[1]), database(isolate,info[2]);
  host_rpc(id,*request,*database,native_rpc_complete);
  info.GetReturnValue().Set(resolver->GetPromise());
}
static void request(const FunctionCallbackInfo<Value>& info) {
  Isolate* isolate = info.GetIsolate(); Local<Context> context = isolate->GetCurrentContext();
  int id = info[0]->Int32Value(context).FromJust();
  int delay = info[1]->Int32Value(context).FromJust();
  if (runtime->pending.count(id) || delay < 0 || delay > 1000) {
    isolate->ThrowException(Exception::Error(String::NewFromUtf8Literal(isolate,"invalid native request"))); return;
  }
  auto resolver = Promise::Resolver::New(context).ToLocalChecked();
  runtime->pending[id].resolver.Reset(isolate,resolver);
  uv_ref(reinterpret_cast<uv_handle_t*>(&runtime->async));
  swift_request(id,delay);
  info.GetReturnValue().Set(resolver->GetPromise());
}
static void cancel(const FunctionCallbackInfo<Value>& info) {
  Isolate* isolate = info.GetIsolate(); Local<Context> context = isolate->GetCurrentContext();
  int id = info[0]->Int32Value(context).FromJust(); auto found = runtime->pending.find(id);
  bool cancelled = found != runtime->pending.end() && !found->second.cancelled;
  if (cancelled) {
    found->second.cancelled = true;
    found->second.resolver.Get(isolate)->Reject(context,Exception::Error(String::NewFromUtf8Literal(isolate,"native_cancelled"))).Check();
  }
  info.GetReturnValue().Set(cancelled);
}
extern "C" int embed_run(void) {
  std::vector<std::string> errors;
  auto setup = node::CommonEnvironmentSetup::Create(platform.get(), &errors, init->args(), init->exec_args());
  if (!setup) { for (auto& e:errors) fprintf(stderr,"%s\n",e.c_str()); return 1; }
  Isolate* isolate = setup->isolate();
  int result;
  {
    Locker locker(isolate); Isolate::Scope isolate_scope(isolate); HandleScope handles(isolate);
    Local<Context> context = setup->context(); Context::Scope scope(context);
    Runtime state; state.isolate=isolate; state.context.Reset(isolate,context); runtime=&state;
    uv_async_init(setup->event_loop(),&state.async,deliver); state.async.data=&state;
    uv_unref(reinterpret_cast<uv_handle_t*>(&state.async));
    context->Global()->Set(context,String::NewFromUtf8Literal(isolate,"nativeAsync"),Function::New(context,request).ToLocalChecked()).Check();
    context->Global()->Set(context,String::NewFromUtf8Literal(isolate,"nativeCancel"),Function::New(context,cancel).ToLocalChecked()).Check();
    context->Global()->Set(context,String::NewFromUtf8Literal(isolate,"nativeRPC"),Function::New(context,rpc_request).ToLocalChecked()).Check();
    int requested_exit = -1;
    node::SetProcessExitHandler(setup->env(), [&](node::Environment* env, int code) { requested_exit = code; node::Stop(env); });
    auto loaded = node::LoadEnvironment(setup->env(), node::StartExecutionCallback{});
    result=loaded.IsEmpty()?1:node::SpinEventLoop(setup->env()).FromMaybe(1);
    if (requested_exit >= 0) result = requested_exit;
    if (!state.pending.empty()) {
      for (auto& entry : state.pending) { entry.second.cancelled = true; entry.second.resolver.Reset(); }
      // Stop JS admission but keep native state and uv_async alive until every terminal callback.
      uv_timer_t deadline; uv_timer_init(setup->event_loop(), &deadline);
      uv_timer_start(&deadline, [](uv_timer_t*) { fprintf(stderr,"FORCED_NATIVE_DRAIN_TIMEOUT\n"); std::_Exit(70); }, 5000, 0);
      while (!state.pending.empty()) uv_run(setup->event_loop(),UV_RUN_ONCE);
      uv_timer_stop(&deadline); uv_close(reinterpret_cast<uv_handle_t*>(&deadline),nullptr);
      uv_run(setup->event_loop(),UV_RUN_NOWAIT);
      fprintf(stderr,"FORCED_NATIVE_DRAIN_PASS\n");
    }
    uv_close(reinterpret_cast<uv_handle_t*>(&state.async),nullptr);
    node::Stop(setup->env());
    uv_run(setup->event_loop(),UV_RUN_NOWAIT);
    state.context.Reset(); runtime=nullptr;
  }
  return result;
}
extern "C" void embed_dispose(void) {
  V8::Dispose(); V8::DisposePlatform(); platform.reset();
  node::TearDownOncePerProcess(); init.reset();
}
