#ifdef __cplusplus
extern "C" {
#endif
#include <stdint.h>
int embed_init(int argc, char **argv);
int embed_run(void);
void embed_dispose(void);
void native_complete(int32_t id, int32_t pid, int32_t main_thread);
void swift_request(int32_t id, int32_t delay_ms);
int32_t host_stream_open(int32_t id, const char *database, int32_t fixture, int32_t (*callback)(int32_t,const char*,int32_t));
int32_t host_stream_write(int32_t id,const char* line);
int32_t host_stream_close(int32_t id,int32_t cancel);
char *host_metadata(const char *database,const char *kind,const char *request);
void host_metadata_free(char *value);
void host_rpc(int32_t id, const char *request, const char *database, void (*callback)(int32_t, const char *, int32_t));

#ifdef __cplusplus
}
#endif
