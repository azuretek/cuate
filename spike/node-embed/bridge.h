#ifdef __cplusplus
extern "C" {
#endif
#include <stdint.h>
int embed_init(int argc, char **argv);
int embed_run(void);
void embed_dispose(void);
void native_complete(int32_t id, int32_t pid, int32_t main_thread);
void swift_request(int32_t id, int32_t delay_ms);
void host_rpc(int32_t id, const char *request, const char *database, void (*callback)(int32_t, const char *, int32_t));

#ifdef __cplusplus
}
#endif
