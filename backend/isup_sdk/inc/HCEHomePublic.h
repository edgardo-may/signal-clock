#ifndef _HC_EHOME_PUBLIC_H_
#define _HC_EHOME_PUBLIC_H_ 

#ifndef _HC_NET_SDK_H_

/*******************OS data type begin**********************/    

#if (defined(_WIN32)) //windows
    #define NET_DVR_API  extern "C" __declspec(dllimport)
    typedef  unsigned __int64 UINT64;
#elif defined(__linux__) || defined(__APPLE__) //linux
    typedef     unsigned int    DWORD;
    typedef     unsigned short  WORD;
    typedef     unsigned short  USHORT;
    typedef     short           SHORT;
    typedef     int             LONG;
    typedef      unsigned char    BYTE;
    #define     BOOL int
    typedef     unsigned int       UINT;
    typedef     void*             LPVOID;
    typedef     void*             HANDLE;
    typedef     unsigned int*  LPDWORD; 
    typedef  unsigned long long UINT64;

    #ifndef    TRUE
    #define    TRUE    1
    #endif
    #ifndef    FALSE
    #define       FALSE 0
    #endif
    #ifndef    NULL
    #define       NULL 0
    #endif

    #define __stdcall 
    #define CALLBACK  

    #define NET_DVR_API extern "C"
#endif //linux

/*******************OS data type end**********************/    

/*******************error code begin**********************/
#define NET_DVR_NOERROR                     0    //No error.
#define NET_DVR_PASSWORD_ERROR                 1    //User name or password error.
#define NET_DVR_NOENOUGHPRI                 2    //Not authorized to do this operation.
#define NET_DVR_NOINIT                         3    //SDK is not initialized.¡£
#define NET_DVR_CHANNEL_ERROR                 4    //Channel number error. There is no corresponding channel number on the device.
#define NET_DVR_OVER_MAXLINK                 5    //The number of connection with the device has exceeded the max limit.
#define NET_DVR_VERSIONNOMATCH                6    //Version mismatch. SDK version is not matching with the device.
#define NET_DVR_NETWORK_FAIL_CONNECT        7    //Failed to connect to the device. The device is off-line, or connection timeout caused by network. .
#define NET_DVR_NETWORK_SEND_ERROR            8    //Failed to send data to the device.
#define NET_DVR_NETWORK_RECV_ERROR            9    //Failed to receive data from the device.
#define NET_DVR_NETWORK_RECV_TIMEOUT        10    //Timeout when receiving the data from the device.
#define NET_DVR_NETWORK_ERRORDATA            11    //The data sent to the device is illegal, or the data received from the device error. E.g. The input data is not supported by the device for remote configuration.
#define NET_DVR_ORDER_ERROR                    12    //API calling order error.
#define NET_DVR_OPERNOPERMIT                13    //Not authorized for this operation.
#define NET_DVR_COMMANDTIMEOUT                14    //Executing command on the device is timeout.

#define NET_DVR_PARAMETER_ERROR             17  //Parameter error. Input or output parameters in the SDK API is NULL, or the value or format of the parameters does not match with the requirement.

#define NET_DVR_NOSUPPORT                    23    //Device does not support this function.

#define    NET_DVR_DVROPRATEFAILED                29  //Device operation failed.

#define NET_DVR_DIR_ERROR                    40    //File directory error.
#define NET_DVR_ALLOC_RESOURCE_ERROR        41  //Resource allocation error.
#define NET_DVR_AUDIO_MODE_ERROR            42    //Sound adapter mode error. Currently opened sound playing mode does not match with the set mode.
#define NET_DVR_NOENOUGH_BUF                43    //Buffer is not enough.
#define NET_DVR_CREATESOCKET_ERROR             44    //Create SOCKET error.
#define NET_DVR_SETSOCKET_ERROR                45    //Set SOCKET error.
#define NET_DVR_MAX_NUM                     46  //The number of login or preview connections has exceeded the SDK limitation.
#define NET_DVR_USERNOTEXIST                47    //User doest not exist. The user ID has been logged out or unavailable. 

#define NET_DVR_GETLOCALIPANDMACFAIL        53  //Failed to get the IP address or physical address of local PC.

#define NET_DVR_VOICEMONOPOLIZE                69    //Sound adapter has been monopolized.

#define NET_DVR_CREATEDIR_ERROR                71    //Failed to create log file directory.
#define NET_DVR_BINDSOCKET_ERROR            72    //Failed to bind socket.
#define NET_DVR_SOCKETCLOSE_ERROR            73    //Socket disconnected. It is caused by network disconnection or destination unreachable.
#define NET_DVR_USERID_ISUSING                74    //The user ID is operating when logout.¡£
#define NET_DVR_SOCKETLISTEN_ERROR            75    //Failed to listen.

#define NET_DVR_CONVERT_SDK_ERROR            85    /*Load SystemTransform.dll failed.*/

#define NET_DVR_FUNCTION_NOT_SUPPORT_OS     98  //This function don't support this OS.

#define NET_DVR_USE_LOG_SWITCH_FILE            103  //Using the log switch file

#define    NET_DVR_PACKET_TYPE_NOT_SUPPORT        105    //Packet type is not supported

#define    NET_DVR_STREAM_ENCRYPT_CHECK_FAIL 130    //stream encrypt check fail

//Error Code of Voice Talk Library 
#define  NET_AUDIOINTERCOM_OK                   600 //No error.
#define  NET_AUDIOINTECOM_ERR_NOTSUPORT         601 //Not support.
#define  NET_AUDIOINTECOM_ERR_ALLOC_MEMERY      602 //Memory allocation error.
#define  NET_AUDIOINTECOM_ERR_PARAMETER         603 //Parameter error.
#define  NET_AUDIOINTECOM_ERR_CALL_ORDER        604 //API calling order error.
#define  NET_AUDIOINTECOM_ERR_FIND_DEVICE       605 //No audio device
#define  NET_AUDIOINTECOM_ERR_OPEN_DEVICE       606 //Failed to open the audio device
#define  NET_AUDIOINTECOM_ERR_NO_CONTEXT        607 //Context error.
#define  NET_AUDIOINTECOM_ERR_NO_WAVFILE        608 //WAV file error.
#define  NET_AUDIOINTECOM_ERR_INVALID_TYPE      609 //The type of WAV parameter is invalid
#define  NET_AUDIOINTECOM_ERR_ENCODE_FAIL       610 //Failed to encode data
#define  NET_AUDIOINTECOM_ERR_DECODE_FAIL       611 //Failed to decode data
#define  NET_AUDIOINTECOM_ERR_NO_PLAYBACK       612 //Failed to play audio
#define  NET_AUDIOINTECOM_ERR_DENOISE_FAIL      613 //Failed to denoise
#define  NET_AUDIOINTECOM_ERR_UNKOWN            619 //Unknown

#define NET_PSS_CLIENT_ERR_KMS_TOKEN_FAIL       3601//KMS picture upload error, get token fail
#define NET_PSS_CLIENT_ERR_KMS_UPLOAD_FAIL      3602//KMS picture upload error, upload fail
/*******************error code begin**********************/    

#define MAX_DEVICE_ID_LEN 256     //the lenght of device ID
#define MAX_PASSWD_LEN    32
#define NAME_LEN          32      //the length of user name
#define NET_EHOME_SERIAL_LEN 12
#define MAX_MASTER_KEY_LEN 16

#define MAX_TIME_LEN                32      //the lenght of time string
#define MAX_URL_LEN_PSS         4096    //the length of url

typedef struct tagNET_EHOME_IPADDRESS
{
    char szIP[128]; 
    WORD wPort;     //port
    char byRes[2];
}NET_EHOME_IPADDRESS, *LPNET_EHOME_IPADDRESS;

typedef struct tagNET_EHOME_ZONE
{
    DWORD dwX;        //X
    DWORD dwY;        //Y
    DWORD dwWidth;  //Width
    DWORD dwHeight;    //Height
}NET_EHOME_ZONE, *LPNET_EHOME_ZONE;


//local config
typedef enum tagNET_EHOME_LOCAL_CFG_TYPE
{
    UNDEFINE = -1,
    ACTIVE_ACCESS_SECURITY = 0,
    AMS_ADDRESS,     
    SEND_PARAM,
    SET_REREGISTER_MODE,    
    LOCAL_CFG_TYPE_GENERAL = 4     
}NET_EHOME_LOCAL_CFG_TYPE, *LPNET_EHOME_LOCAL_CFG_TYPE;

typedef struct tagNET_EHOME_LOCAL_ACCESS_SECURITY
{
    DWORD   dwSize;
    BYTE    byAccessSecurity;
    BYTE    byRes[127];
}NET_EHOME_LOCAL_ACCESS_SECURITY,*LPNET_EHOME_LOCAL_ACCESS_SECURITY;

typedef struct tagNET_EHOME_AMS_ADDRESS
{
    DWORD dwSize;
    BYTE  byEnable;  //0-disable CMS receive alarm£¬1-enable CMS receive alarm
    BYTE  byRes1[3];
    NET_EHOME_IPADDRESS  struAddress;    //AMS loop back address
    BYTE byRes2[32];
}NET_EHOME_AMS_ADDRESS, *LPNET_EHOME_AMS_ADDRESS;

typedef struct tagNET_EHOME_SEND_PARAM
{
    DWORD dwSize;
    DWORD dwRecvTimeOut;    //recv timeout
    BYTE  bySendTimes;      //send times
    BYTE  byRes2[127];
}NET_EHOME_SEND_PARAM, *LPNET_EHOME_SEND_PARAM;

typedef struct tagNET_EHOME_DEV_SESSIONKEY
{
    BYTE   sDeviceID[MAX_DEVICE_ID_LEN];    				//device ID/*256*/
    BYTE   sSessionKey[MAX_MASTER_KEY_LEN];       //Sessionkey/*16*/
} NET_EHOME_DEV_SESSIONKEY, *LPNET_EHOME_DEV_SESSIONKEY;

typedef struct tagNET_EHOME_SET_REREGISTER_MODE
{
    DWORD dwSize;
    DWORD dwReRegisterMode;    
}NET_EHOME_SET_REREGISTER_MODE, *LPNET_EHOME_SET_REREGISTER_MODE;
typedef struct tagNET_EHOME_LOCAL_GENERAL_CFG
{
    BYTE byAlarmPictureSeparate;   
    BYTE byRes[127];    
}NET_EHOME_LOCAL_GENERAL_CFG, *LPNET_EHOME_LOCAL_GENERAL_CFG;
#endif //_HC_NET_SDK_H_


#endif //_HC_EHOME_PUBLIC_H_
