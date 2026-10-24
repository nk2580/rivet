// Microphone audio never leaves this process. stdout contains bounded JSON text events only.
#define NOMINMAX
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#define MA_NO_RESOURCE_MANAGER
#define MA_NO_NODE_GRAPH
#define MA_NO_ENGINE
#include "miniaudio.h"
#include <atomic>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#else
#include <dlfcn.h>
#include <sys/resource.h>
#endif

static std::string quote(const std::string& value){std::ostringstream out;out<<'"';for(unsigned char c:value){if(c=='"'||c=='\\')out<<'\\'<<c;else if(c<32)out<<' ';else out<<c;}out<<'"';return out.str();}
static void error(const std::string& message){std::cout<<"{\"type\":\"error\",\"message\":"<<quote(message)<<"}"<<std::endl;}
static std::string compact(const char* json){std::string out;bool quoted=false,escaped=false;for(const char* p=json;*p;++p){char c=*p;if(quoted||!std::isspace(static_cast<unsigned char>(c)))out+=c;if(c=='"'&&!escaped)quoted=!quoted;if(c=='\\'&&!escaped)escaped=true;else escaped=false;}return out;}
static void benchmark(uint64_t samples){
  double cpuMs=0;uint64_t peak=0;
#ifdef _WIN32
  FILETIME created,exited,kernel,user;GetProcessTimes(GetCurrentProcess(),&created,&exited,&kernel,&user);ULARGE_INTEGER k,u;k.LowPart=kernel.dwLowDateTime;k.HighPart=kernel.dwHighDateTime;u.LowPart=user.dwLowDateTime;u.HighPart=user.dwHighDateTime;cpuMs=(k.QuadPart+u.QuadPart)/10000.0;PROCESS_MEMORY_COUNTERS memory{};GetProcessMemoryInfo(GetCurrentProcess(),&memory,sizeof(memory));peak=memory.PeakWorkingSetSize;
#else
  struct rusage usage{};getrusage(RUSAGE_SELF,&usage);cpuMs=(usage.ru_utime.tv_sec+usage.ru_stime.tv_sec)*1000.0+(usage.ru_utime.tv_usec+usage.ru_stime.tv_usec)/1000.0;peak=usage.ru_maxrss;
#ifndef __APPLE__
  peak*=1024;
#endif
#endif
  std::cout<<"{\"type\":\"benchmark\",\"audioMs\":"<<samples/16<<",\"cpuMs\":"<<cpuMs<<",\"peakResidentBytes\":"<<peak<<'}'<<std::endl;
}
struct Vosk {
  void* library=nullptr;
  void (*log)(int)=nullptr;void* (*model_new)(const char*)=nullptr;void (*model_free)(void*)=nullptr;
  void* (*recognizer_new)(void*,float)=nullptr;void (*recognizer_free)(void*)=nullptr;
  int (*accept)(void*,const char*,int)=nullptr;const char* (*result)(void*)=nullptr;const char* (*final_result)(void*)=nullptr;
  void (*words)(void*,int)=nullptr;void (*reset)(void*)=nullptr;
  template<typename T>bool symbol(T& target,const char* name){
#ifdef _WIN32
    target=reinterpret_cast<T>(GetProcAddress(reinterpret_cast<HMODULE>(library),name));
#else
    target=reinterpret_cast<T>(dlsym(library,name));
#endif
    return target!=nullptr;
  }
  bool load(const char* path){
#ifdef _WIN32
    library=reinterpret_cast<void*>(LoadLibraryA(path));
#else
    library=dlopen(path,RTLD_NOW|RTLD_LOCAL);
#endif
    return library&&symbol(log,"vosk_set_log_level")&&symbol(model_new,"vosk_model_new")&&symbol(model_free,"vosk_model_free")&&symbol(recognizer_new,"vosk_recognizer_new")&&symbol(recognizer_free,"vosk_recognizer_free")&&symbol(accept,"vosk_recognizer_accept_waveform")&&symbol(result,"vosk_recognizer_result")&&symbol(final_result,"vosk_recognizer_final_result")&&symbol(words,"vosk_recognizer_set_words")&&symbol(reset,"vosk_recognizer_reset");
  }
};
struct Ring {
  static constexpr size_t capacity=16000*5;
  ma_int16 samples[capacity]{};
  std::atomic<uint64_t> written{0},read{0};std::atomic<bool> stopped{false},overflow{false},disconnected{false};
};
static void audio(ma_device* device,void*,const void* input,ma_uint32 frames){
  auto* ring=static_cast<Ring*>(device->pUserData);if(!input||ring->stopped)return;
  const auto written=ring->written.load(std::memory_order_relaxed),read=ring->read.load(std::memory_order_acquire);
  if(written-read+frames>Ring::capacity){ring->overflow=true;ring->stopped=true;return;}
  const auto* samples=static_cast<const ma_int16*>(input);for(ma_uint32 i=0;i<frames;++i)ring->samples[(written+i)%Ring::capacity]=samples[i];
  ring->written.store(written+frames,std::memory_order_release);
}
static void notification(const ma_device_notification* event){auto* ring=static_cast<Ring*>(event->pDevice->pUserData);if(event->type==ma_device_notification_type_stopped&&!ring->stopped){ring->disconnected=true;ring->stopped=true;}}

int main(int argc,char** argv){
  if(argc<2)return 2;
  const std::string command=argv[1];
  if(command=="--devices"){
    ma_context context;if(ma_context_init(nullptr,0,nullptr,&context)!=MA_SUCCESS){error("Microphone devices are unavailable.");return 1;}
    ma_device_info* devices=nullptr;ma_uint32 count=0;
    if(ma_context_get_devices(&context,nullptr,nullptr,&devices,&count)!=MA_SUCCESS){ma_context_uninit(&context);error("Could not list microphones.");return 1;}
    std::cout<<"{\"type\":\"devices\",\"devices\":[";
    for(ma_uint32 i=0;i<count;++i){if(i)std::cout<<',';std::cout<<"{\"id\":"<<quote(std::to_string(i)+":"+devices[i].name)<<",\"name\":"<<quote(devices[i].name)<<",\"isDefault\":"<<(devices[i].isDefault?"true":"false")<<'}';}
    std::cout<<"]}"<<std::endl;ma_context_uninit(&context);return 0;
  }
  if(argc<4||(command!="--listen"&&command!="--file"))return 2;
  Vosk api;if(!api.load(argv[2])){error("The bundled speech library could not load.");return 1;}
  api.log(-1);void* model=api.model_new(argv[3]);if(!model){error("The English speech model could not load. Reinstall it in Settings.");return 1;}
  void* recognizer=api.recognizer_new(model,16000.0f);if(!recognizer){api.model_free(model);error("Speech recognition could not start.");return 1;}
  api.words(recognizer,1);
  uint64_t processed=0,segmentStart=0,lastForced=0;
  auto emit=[&](const char* result){std::cout<<"{\"type\":\"speech\",\"startMs\":"<<segmentStart/16<<",\"endMs\":"<<processed/16<<",\"result\":"<<compact(result)<<'}'<<std::endl;segmentStart=processed;};
  auto process=[&](const ma_int16* samples,size_t count){processed+=count;if(api.accept(recognizer,reinterpret_cast<const char*>(samples),static_cast<int>(count*2))){emit(api.result(recognizer));lastForced=processed;}else if(processed-lastForced>=16000*15){emit(api.final_result(recognizer));api.reset(recognizer);lastForced=processed;}};
  if(command=="--file"){
    if(argc<5){api.recognizer_free(recognizer);api.model_free(model);return 2;}
    ma_decoder decoder;auto config=ma_decoder_config_init(ma_format_s16,1,16000);
    if(ma_decoder_init_file(argv[4],&config,&decoder)!=MA_SUCCESS){error("Could not read the benchmark audio.");api.recognizer_free(recognizer);api.model_free(model);return 1;}
    ma_int16 samples[3200];ma_uint64 read=0;
    while(ma_decoder_read_pcm_frames(&decoder,samples,3200,&read)==MA_SUCCESS&&read)process(samples,static_cast<size_t>(read));
    if(read)process(samples,static_cast<size_t>(read));
    emit(api.final_result(recognizer));ma_decoder_uninit(&decoder);api.recognizer_free(recognizer);api.model_free(model);benchmark(processed);return 0;
  }
  ma_context context;if(ma_context_init(nullptr,0,nullptr,&context)!=MA_SUCCESS){error("Microphone access is unavailable.");api.recognizer_free(recognizer);api.model_free(model);return 1;}
  ma_device_info* devices=nullptr;ma_uint32 count=0;ma_context_get_devices(&context,nullptr,nullptr,&devices,&count);
  ma_device_id* selected=nullptr;
  const std::string wanted=argc>4?argv[4]:"";
  if(!wanted.empty()){for(ma_uint32 i=0;i<count;++i)if(wanted==std::to_string(i)+":"+devices[i].name){selected=&devices[i].id;break;}if(!selected){error("The selected microphone is disconnected or changed. Choose one in Settings.");ma_context_uninit(&context);api.recognizer_free(recognizer);api.model_free(model);return 1;}}
  Ring ring;ma_device device;auto config=ma_device_config_init(ma_device_type_capture);
  config.capture.pDeviceID=selected;config.capture.format=ma_format_s16;config.capture.channels=1;config.sampleRate=16000;
  config.dataCallback=audio;config.notificationCallback=notification;config.pUserData=&ring;config.periodSizeInMilliseconds=50;
  if(ma_device_init(&context,&config,&device)!=MA_SUCCESS){error("Could not open the microphone. Check system microphone permissions.");ma_context_uninit(&context);api.recognizer_free(recognizer);api.model_free(model);return 1;}
  if(ma_device_start(&device)!=MA_SUCCESS){error("Could not start the microphone.");ma_device_uninit(&device);ma_context_uninit(&context);api.recognizer_free(recognizer);api.model_free(model);return 1;}
  std::thread control([&](){std::string line;std::getline(std::cin,line);ring.stopped=true;});
  std::cout<<"{\"type\":\"ready\"}"<<std::endl;
  ma_int16 samples[3200];
  while(!ring.stopped){
    auto read=ring.read.load(std::memory_order_relaxed),written=ring.written.load(std::memory_order_acquire);
    const size_t n=static_cast<size_t>(std::min<uint64_t>(written-read,3200));
    if(n){for(size_t i=0;i<n;++i)samples[i]=ring.samples[(read+i)%Ring::capacity];ring.read.store(read+n,std::memory_order_release);process(samples,n);}else std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
  ma_device_stop(&device);
  // Drain the bounded tail before finalising, including speech immediately before Pause.
  auto read=ring.read.load(),written=ring.written.load();while(read<written){size_t n=static_cast<size_t>(std::min<uint64_t>(written-read,3200));for(size_t i=0;i<n;++i)samples[i]=ring.samples[(read+i)%Ring::capacity];process(samples,n);read+=n;}
  emit(api.final_result(recognizer));
  if(ring.overflow)error("Speech processing fell behind. Listening paused; some audio was not captured.");
  if(ring.disconnected)error("Microphone capture stopped. Speech during the interruption was not captured.");
  ma_device_uninit(&device);ma_context_uninit(&context);api.recognizer_free(recognizer);api.model_free(model);
  if(control.joinable())control.join();
  return ring.overflow||ring.disconnected?1:0;
}
