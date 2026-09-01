#ifndef _AUDIO_INTERCOM_H_
#define _AUDIO_INTERCOM_H_

#ifdef WIN32
    #if defined(_WINDLL)
        #define AUDIOCOM_API  __declspec(dllexport) 
    #else 
        #define AUDIOCOM_API  __declspec(dllimport) 
    #endif
#else
    #ifndef __stdcall
        #define __stdcall
    #endif

    #ifndef AUDIOCOM_API
        #define AUDIOCOM_API
    #endif
#endif


#define ERROR_NO            1
#define ERROR_ALLOC_MEMORY  2
#define ERROR_PARAMETER     3
#define ERROR_CALL_ORDER    4
#define ERROR_FIND_DEVICE   5
#define ERROR_OPEN_DEVICE   6
#define ERROR_NO_CONTEXT    7
#define ERROR_NO_WAVEFILE   8
#define ERROR_INVALID_TYPE  9
#define ERROR_ENCODE_FAIL   10
#define ERROR_DECODE_FAIL   11
#define ERROR_NO_PLAYBACK   12
#define ERROR_DENOISE_FAIL  13
#define ERROR_SUPPORT       14
#define ERROR_UNKNOWN       99

typedef struct _SOUND_CARD_INFO
{
    char           byDeviceName[128];
    unsigned int   dwFrequency;
    unsigned int   dwRefresh;
    unsigned int   dwSync;
    unsigned int   dwMonoSources;
    unsigned int   dwStereoSources;
    unsigned int   dwMajorVersion;
    unsigned int   dwMinorVersion;
    unsigned int   dwReserved[16];
}SoundCardInfo;

typedef enum _CHANNEL_PCM_
{
    CHANNEL_1 = 1,
    CHANNEL_2 = 2
}ChannelPcm;

typedef enum _BITWIDTH_PCM_
{
    BITS_08 = 8,
    BITS_16 = 16
}BitsPcm;

typedef enum _SAMPLERATE_PCM_
{
    SAMPLERATE_08K  =  8000,
    SAMPLERATE_16K  = 16000,
    SAMPLERATE_32K  = 32000,
    SAMPLERATE_44K1 = 44100,
    SAMPLERATE_48K  = 48000
}SampleratePcm;

typedef enum _BITRATE_ENCODE_
{
    BITRATE_ENCODE_08k = 8000,
    BITRATE_ENCODE_16k = 16000,
    BITRATE_ENCODE_32k = 32000,
	BITRATE_ENCODE_64k = 64000,
	BITRATE_ENCODE_128k = 128000
	
}BitRateEncode;

typedef enum _AUDIO_ENCODE_TYPE_EX
{
    AUDIO_TYPE_PCM    = 0x00,
    AUDIO_TYPE_G711A  = 0x01,
    AUDIO_TYPE_G711U  = 0x02,
    AUDIO_TYPE_G722   = 0x03,
    AUDIO_TYPE_G726   = 0x04,
    AUDIO_TYPE_MPEG2  = 0x05,
    AUDIO_TYPE_AAC    = 0x06,
    AUDIO_TYPE_G729   = 0x07,
    AUDIO_TYPE_ADPCM  = 0x08
}AudioEncodeTypeEx;

typedef enum _AUDIO_ENCODE_TYPE
{
    AUDIO_TYPE_PCM_S16K    = 0x00,
    AUDIO_TYPE_G711A_S8K   = 0x01,
    AUDIO_TYPE_G711U_S8K   = 0x02,
    AUDIO_TYPE_G722_S16K   = 0x03,
    AUDIO_TYPE_G726_S8K    = 0x04,
    AUDIO_TYPE_MPEG2_S16K  = 0x05,
    AUDIO_TYPE_AAC_S32K    = 0x06,
    AUDIO_TYPE_PCM_S8K	   = 0x07,
    AUDIO_TYPE_PCM_S32K    = 0x08,
    AUDIO_TYPE_AAC_S16K	   = 0x09
}AudioEncodeType;

typedef struct _AUDIO_PARAM_
{
    unsigned short    nChannel;
    unsigned short    nBitWidth;
    unsigned int      nSampleRate;
    unsigned int      nBitRate;
    AudioEncodeTypeEx enAudioEncodeTypeEx;
}AudioParam;


typedef struct _OUTPUT_DATA_INFO_EX_ 
{
    unsigned char*    pData;
    unsigned int      dwDataLen;
    AudioEncodeTypeEx enDataTypeEx;
}OutputDataInfoEx;

typedef struct _OUTPUT_DATA_INFO_
{
    unsigned char*    pData;
    unsigned int      dwDataLen;
    AudioEncodeType   enDataType;
}OutputDataInfo;

typedef void (__stdcall* OutputDataCallBack)(OutputDataInfo* pstDataInfo,void* pUser);
typedef void (__stdcall* OutputDataCallBackEx)(OutputDataInfoEx* pstDataInfo,void* pUser);


#ifdef __cplusplus
extern "C" {
#endif


AUDIOCOM_API int __stdcall AUDIOCOM_GetSoundCardNum(unsigned int* pdwDeviceNum);

AUDIOCOM_API int __stdcall AUDIOCOM_GetOneSoundCardInfo(unsigned int dwDeviceIndex, SoundCardInfo* pstDeviceInfo);

AUDIOCOM_API int __stdcall AUDIOCOM_GetCaptureDeviceNum(unsigned int* pCaptureDeviceNum);

AUDIOCOM_API int __stdcall AUDIOCOM_GetOneCaptureDeviceName(unsigned int dwCaptureDeviceIndex, char* pCaptureDeviceName);

AUDIOCOM_API int __stdcall AUDIOCOM_GetPlayDeviceNum(unsigned int* pPlayDeviceNum);

AUDIOCOM_API int __stdcall AUDIOCOM_GetOnePlayDeviceName(unsigned int dwPlayDeviceIndex, char* pPlayDeviceName);

AUDIOCOM_API int __stdcall AUDIOCOM_CreateCaptureHandle(int* pnCapturePort, const char* pDeviceName);

AUDIOCOM_API int __stdcall AUDIOCOM_CreateCaptureHandleEx(int* pnCapturePort, const char* pCapDeviceName);

AUDIOCOM_API int __stdcall AUDIOCOM_RegisterOutputDataCallBack(int nCapturePort, 
                                                               AudioEncodeType enDataType, 
                                                               OutputDataCallBack pfnOutputDataCallBack, 
                                                               void* pUser);

AUDIOCOM_API int __stdcall AUDIOCOM_RegisterOutputDataCallBackEx(int nCapturePort, 
                                                                 AudioParam *pstAudioParam, 
                                                                 OutputDataCallBackEx pfnOutputDataCallBack, 
                                                                 void* pUser);

AUDIOCOM_API int __stdcall AUDIOCOM_StartCapture(int nCapturePort);

AUDIOCOM_API int __stdcall AUDIOCOM_StopCapture(int nCapturePort);

AUDIOCOM_API int __stdcall AUDIOCOM_RegisterCaptureDataCallBack(int nCapturePort, 
                                                                OutputDataCallBack pfnCaptureDataCallBack, 
                                                                void* pUser);

AUDIOCOM_API int __stdcall AUDIOCOM_RegisterCaptureDataCallBackEx(int nCapturePort, 
                                                                  OutputDataCallBackEx pfnCaptureDataCallBack, 
                                                                  void* pUser);

AUDIOCOM_API int __stdcall AUDIOCOM_ReleaseCaptureHandle(int nCapturePort);

AUDIOCOM_API int __stdcall AUDIOCOM_ReleaseCaptureHandleEx(int nCapturePort);

AUDIOCOM_API int __stdcall AUDIOCOM_CreatePlayHandle(int* pnPlayPort, const char* pDeviceName);


AUDIOCOM_API int __stdcall AUDIOCOM_CreatePlayHandleEx(int* pnPlayPort, const char* pDeviceName);

AUDIOCOM_API int __stdcall AUDIOCOM_OpenStream(int nPlayPort, AudioEncodeType enDataType);

AUDIOCOM_API int __stdcall AUDIOCOM_OpenStreamEx(int nPlayPort, AudioParam *pstAudioParam);

AUDIOCOM_API int __stdcall AUDIOCOM_InputStreamData(int nPlayPort, unsigned char* pData, unsigned int dwDataLen);

AUDIOCOM_API int __stdcall AUDIOCOM_StartPlay(int nPlayPort);

AUDIOCOM_API int __stdcall AUDIOCOM_StopPlay(int nPlayPort);

AUDIOCOM_API int __stdcall AUDIOCOM_RegisterDecodeDataCallBack(int nPlayPort, 
                                                               OutputDataCallBack pfnDecodeDataCallBack, 
                                                               void* pUser);

AUDIOCOM_API int __stdcall AUDIOCOM_RegisterDecodeDataCallBackEx(int nPlayPort, 
                                                                 OutputDataCallBackEx pfnDecodeDataCallBack, 
                                                                 void* pUser);

AUDIOCOM_API int __stdcall AUDIOCOM_SetVolume(int nPlayPort, float fVolume);

AUDIOCOM_API int __stdcall AUDIOCOM_GetVolume(int nPlayPort, float* fVolume);

AUDIOCOM_API int __stdcall AUDIOCOM_ReleasePlayHandle(int nPlayPort);

AUDIOCOM_API int __stdcall AUDIOCOM_GetLastError(int nPort);

AUDIOCOM_API unsigned int __stdcall AUDIOCOM_GetVersion();

#ifdef __cplusplus
}
#endif


#endif//_AUDIO_INTERCOM_H_
