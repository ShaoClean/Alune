#include <node_api.h>
#include <Security/Security.h>
#include <cstring>
#include <string>
#include <vector>

static const char* service = "io.alune.agent.master.v1";
static napi_value fail(napi_env env, const char* code) {
  napi_throw_error(env, code, "Agent Keychain operation failed");
  return nullptr;
}
static bool text(napi_env env, napi_value value, std::string& output, size_t maximum) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || size > maximum) return false;
  std::vector<char> data(size + 1);
  if (napi_get_value_string_utf8(env, value, data.data(), data.size(), &size) != napi_ok) return false;
  output.assign(data.data(), size);
  return output.find('\0') == std::string::npos;
}
struct Keychain {
  SecKeychainRef value = nullptr;
  ~Keychain() { if (value) CFRelease(value); }
};
struct NoInteraction {
  Boolean previous = true;
  bool restore = false;
  bool ready = false;
  NoInteraction() {
    restore = SecKeychainGetUserInteractionAllowed(&previous) == errSecSuccess;
    if (restore) ready = SecKeychainSetUserInteractionAllowed(false) == errSecSuccess;
  }
  ~NoInteraction() { if (ready && restore) SecKeychainSetUserInteractionAllowed(previous); }
};
static bool openKeychain(napi_env env, napi_value argument, Keychain& keychain) {
  napi_valuetype type;
  if (napi_typeof(env, argument, &type) != napi_ok) return false;
  if (type == napi_undefined || type == napi_null) return true;
  std::string file;
  if (!text(env, argument, file, 4096) || file.empty()) return false;
  return SecKeychainOpen(file.c_str(), &keychain.value) == errSecSuccess;
}
static bool account(napi_env env, napi_value value, std::string& result) {
  if (!text(env, value, result, 128) || result.size() != 36) return false;
  for (size_t i=0;i<result.size();i++) {
    const char c=result[i];
    if (i==8 || i==13 || i==18 || i==23) { if (c!='-') return false; }
    else if (!((c>='0' && c<='9') || (c>='a' && c<='f') || (c>='A' && c<='F'))) return false;
  }
  return true;
}
static napi_value lookup(napi_env env, SecKeychainRef keychain, const std::string& id, OSStatus& status) {
  UInt32 length=0; void* data=nullptr;
  status=SecKeychainFindGenericPassword(keychain, static_cast<UInt32>(strlen(service)), service,
    static_cast<UInt32>(id.size()), id.c_str(), &length, &data, nullptr);
  napi_value result;
  if (status==errSecItemNotFound) { napi_get_null(env,&result); return result; }
  if (status!=errSecSuccess) return fail(env, ("KEYCHAIN_"+std::to_string(status)).c_str());
  if (length!=32) {
    SecKeychainItemFreeContent(nullptr,data);
    return fail(env,"KEYCHAIN_KEY_INVALID");
  }
  const napi_status copied=napi_create_buffer_copy(env,length,data,nullptr,&result);
  volatile unsigned char* bytes=static_cast<volatile unsigned char*>(data);
  for (UInt32 i=0;i<length;i++) bytes[i]=0;
  SecKeychainItemFreeContent(nullptr,data);
  return copied==napi_ok ? result : fail(env,"KEYCHAIN_RESULT_FAILED");
}
static napi_value read(napi_env env, napi_callback_info info) {
  napi_value args[2]; size_t count=2; napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
  std::string id; if(count<1 || !account(env,args[0],id)) return fail(env,"KEYCHAIN_INVALID_ARGUMENT");
  NoInteraction interaction; Keychain keychain;
  if (!interaction.ready) return fail(env,"KEYCHAIN_UNAVAILABLE");
  if(count>1 && !openKeychain(env,args[1],keychain)) return fail(env,"KEYCHAIN_UNAVAILABLE");
  OSStatus status; return lookup(env,keychain.value,id,status);
}
static napi_value create(napi_env env, napi_callback_info info) {
  napi_value args[3]; size_t count=3; napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
  std::string id; void* bytes=nullptr; size_t length=0; bool buffer=false;
  if(count<2 || !account(env,args[0],id) || napi_is_buffer(env,args[1],&buffer)!=napi_ok || !buffer
    || napi_get_buffer_info(env,args[1],&bytes,&length)!=napi_ok || length!=32) return fail(env,"KEYCHAIN_INVALID_ARGUMENT");
  NoInteraction interaction; Keychain keychain;
  if (!interaction.ready) return fail(env,"KEYCHAIN_UNAVAILABLE");
  if(count>2 && !openKeychain(env,args[2],keychain)) return fail(env,"KEYCHAIN_UNAVAILABLE");
  OSStatus status; napi_value existing=lookup(env,keychain.value,id,status);
  if(status!=errSecItemNotFound) return existing;
  status=SecKeychainAddGenericPassword(keychain.value,static_cast<UInt32>(strlen(service)),service,
    static_cast<UInt32>(id.size()),id.c_str(),32,bytes,nullptr);
  if(status!=errSecSuccess && status!=errSecDuplicateItem) return fail(env,("KEYCHAIN_"+std::to_string(status)).c_str());
  return lookup(env,keychain.value,id,status);
}
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor methods[]={{"read",nullptr,read,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"create",nullptr,create,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,2,methods); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
