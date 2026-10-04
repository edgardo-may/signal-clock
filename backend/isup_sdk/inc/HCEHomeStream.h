#ifndef _HC_EHOME_STREAM_H_
#define _HC_EHOME_STREAM_H_

#include "HCEHomePublic.h"

typedef struct tagNET_EHOME_NEWLINK_CB_MSG
{
    BYTE    szDeviceID[MAX_DEVICE_ID_LEN];
    LONG    iSessionID;
    DWORD   dwChannelNo;
    BYTE    byStreamType;
    BYTE    byRes1[3];
    char    sDeviceSerial[NET_EHOME_SERIAL_LEN];
    BYTE    byRes[112];
}NET_EHOME_NEWLINK_CB_MSG, *LPNET_EHOME_NEWLINK_CB_MSG;


typedef BOOL (CALLBACK *PREVIEW_NEWLINK_CB)(LONG iLinkHandle,NET_EHOME_NEWLINK_CB_MSG *pNewLinkCBMsg, void *pUserData);

typedef struct tagNET_EHOME_LISTEN_PREVIEW_CFG
{
    NET_EHOME_IPADDRESS struIPAdress; //Local listening information, if the IP address is 0.0.0.0, it is considered as the local address. 
    PREVIEW_NEWLINK_CB    fnNewLinkCB; //The callback function of requiring live view 
    void*               pUser;        // User data 
    BYTE                byLinkMode;   //The listening connection mode, 0- TCP£¨1- UDP 2-HRUDP
    BYTE                byRes[127];
}NET_EHOME_LISTEN_PREVIEW_CFG, *LPNET_EHOME_LISTEN_PREVIEW_CFG;

typedef struct tagNET_EHOME_PREVIEW_CB_MSG
{
    BYTE     byDataType;       //Data type:NET_DVR_SYSHEAD(1)- Stream header, NET_DVR_STREAMDATA(2)- Stream data 
    BYTE     byRes1[3];
    void    *pRecvdata;      //Data buffer, for saving stream header or data. 
    DWORD   dwDataLen;      //Data length 
    BYTE     byRes2[128];
}NET_EHOME_PREVIEW_CB_MSG, *LPNET_EHOME_PREVIEW_CB_MSG;
typedef void(CALLBACK *PREVIEW_DATA_CB)( LONG  iPreviewHandle, NET_EHOME_PREVIEW_CB_MSG *pPreviewCBMsg,     void *pUserData);
typedef struct tagNET_EHOME_PREVIEW_DATA_CB_PARAM
{
    PREVIEW_DATA_CB    fnPreviewDataCB;    //Live view data callback function 
    void       *pUserData;         //User data 
    BYTE       byStreamFormat; //0- PS
    BYTE       byRes[127];          //±£¡Ù 
}NET_EHOME_PREVIEW_DATA_CB_PARAM, *LPNET_EHOME_PREVIEW_DATA_CB_PARAM;

NET_DVR_API BOOL CALLBACK NET_ESTREAM_Init();

NET_DVR_API BOOL CALLBACK NET_ESTREAM_Fini();

NET_DVR_API BOOL CALLBACK NET_ESTREAM_GetLastError();

NET_DVR_API BOOL CALLBACK NET_ESTREAM_SetExceptionCallBack(DWORD dwMessage, HANDLE hWnd, void (CALLBACK* fExceptionCallBack)(DWORD dwType, LONG iUserID, LONG iHandle, void* pUser), void* pUser );

NET_DVR_API BOOL CALLBACK NET_ESTREAM_SetLogToFile( LONG iLogLevel, char *strLogDir, BOOL bAutoDel );

//get build version
NET_DVR_API DWORD CALLBACK NET_ESTREAM_GetBuildVersion();

NET_DVR_API LONG CALLBACK NET_ESTREAM_StartListenPreview(LPNET_EHOME_LISTEN_PREVIEW_CFG pListenParam);

NET_DVR_API BOOL CALLBACK NET_ESTREAM_StopListenPreview(LONG iListenHandle);

NET_DVR_API BOOL CALLBACK NET_ESTREAM_StopPreview(LONG iPreviewHandle);

NET_DVR_API BOOL CALLBACK NET_ESTREAM_SetPreviewDataCB(LONG iHandle, LPNET_EHOME_PREVIEW_DATA_CB_PARAM pStruCBParam);

NET_DVR_API BOOL CALLBACK NET_ESTREAM_SetStandardPreviewDataCB(LONG iHandle, LPNET_EHOME_PREVIEW_DATA_CB_PARAM pStruCBParam);

#define    NET_EHOME_DEVICEID_LEN        256 //the length of device ID

typedef struct tagNET_EHOME_PLAYBACK_NEWLINK_CB_INFO
{
    char         szDeviceID[NET_EHOME_DEVICEID_LEN];
    LONG         lSessionID;
    DWORD        dwChannelNo;
    char         sDeviceSerial[NET_EHOME_SERIAL_LEN/*12*/];
    BYTE         byRes[108];
}NET_EHOME_PLAYBACK_NEWLINK_CB_INFO, *LPNET_EHOME_PLAYBACK_NEWLINK_CB_INFO;


typedef BOOL (CALLBACK *PLAYBACK_NEWLINK_CB)(LONG lPlayBackLinkHandle, NET_EHOME_PLAYBACK_NEWLINK_CB_INFO *pNewLinkCBInfo, void* pUserData);


typedef struct tagNET_EHOME_PLAYBACK_LISTEN_PARAM
{
    NET_EHOME_IPADDRESS struIPAdress;   //Local listening information, if the IP address is *.0.0.0, it is considered as the local address. 
    PLAYBACK_NEWLINK_CB fnNewLinkCB;    //The callback function of requiring playback 
    void*                 pUserData;        //User data 
    BYTE                byLinkMode;     //The listening connection mode,0- TCP£¨1- UDP(UDP reserved) 
    BYTE                byRes[127];
}NET_EHOME_PLAYBACK_LISTEN_PARAM, *LPNET_EHOME_PLAYBACK_LISTEN_PARAM;

typedef struct tagNET_EHOME_PLAYBACK_DATA_CB_INFO
{
    DWORD   dwType;                    //type 0-header 1-stream data
    BYTE     *pData;                    //data
    DWORD     dwDataLen;                //data length
    BYTE    byRes[128];                
}NET_EHOME_PLAYBACK_DATA_CB_INFO, *LPNET_EHOME_PLAYBACK_DATA_CB_INFO;


typedef BOOL (CALLBACK *PLAYBACK_DATA_CB)(LONG iPlayBackLinkHandle, NET_EHOME_PLAYBACK_DATA_CB_INFO *pDataCBInfo, void* pUserData);


typedef struct tagNET_EHOME_PLAYBACK_DATA_CB_PARAM
{
    PLAYBACK_DATA_CB    fnPlayBackDataCB;        //data callback function
    void*                pUserData;                //user data
    BYTE                byStreamFormat;            //Stream format,0-PS 1-RTP 
    BYTE                 byRes[127];            
}NET_EHOME_PLAYBACK_DATA_CB_PARAM, *LPNET_EHOME_PLAYBACK_DATA_CB_PARAM;

#define    EHOME_PREVIEW_EXCEPTION        0x102     //preview exception
#define    EHOME_PLAYBACK_EXCEPTION       0x103     //playback exception
#define    EHOME_AUDIOTALK_EXCEPTION         0x104     //audio talk exception

#define NET_EHOME_SYSHEAD           1    //stream header
#define NET_EHOME_STREAMDATA        2    //stream data

NET_DVR_API LONG CALLBACK NET_ESTREAM_StartListenPlayBack(LPNET_EHOME_PLAYBACK_LISTEN_PARAM pListenParam);
NET_DVR_API BOOL CALLBACK NET_ESTREAM_SetPlayBackDataCB(LONG iPlayBackLinkHandle, NET_EHOME_PLAYBACK_DATA_CB_PARAM *pDataCBParam);
NET_DVR_API BOOL CALLBACK NET_ESTREAM_StopPlayBack(LONG iPlayBackLinkHandle);
NET_DVR_API BOOL CALLBACK NET_ESTREAM_StopListenPlayBack(LONG iPlaybackListenHandle);

//--------------------------------------------------------------------------------------------------------------
#define NET_EHOME_DEVICEID_LEN      256
#define NET_EHOME_SERIAL_LEN        12

typedef struct tagNET_EHOME_VOICETALK_NEWLINK_CB_INFO
{
    BYTE    szDeviceID[NET_EHOME_DEVICEID_LEN/*256*/];
    DWORD   dwEncodeType;
    char    sDeviceSerial[NET_EHOME_SERIAL_LEN/*12*/];
    DWORD   dwAudioChan;
    LONG    lSessionID;
    BYTE    byToken[64];
    BYTE    byRes[64];
} NET_EHOME_VOICETALK_NEWLINK_CB_INFO, *LPNET_EHOME_VOICETALK_NEWLINK_CB_INFO;


typedef BOOL (CALLBACK *VOICETALK_NEWLINK_CB)(LONG lHandle, NET_EHOME_VOICETALK_NEWLINK_CB_INFO *pNewLinkCBInfo, void* pUserData);

typedef struct tagNET_EHOME_LISTEN_VOICETALK_CFG
{
    NET_EHOME_IPADDRESS struIPAdress;
    VOICETALK_NEWLINK_CB     fnNewLinkCB;
    void*          pUser;
    BYTE           byRes[128];
}NET_EHOME_LISTEN_VOICETALK_CFG, *LPNET_EHOME_LISTEN_VOICETALK_CFG;

typedef struct tagNET_EHOME_VOICETALK_DATA_CB_INFO
{
    BYTE         *pData;
    DWORD        dwDataLen;
    BYTE         byRes[128];
}NET_EHOME_VOICETALK_DATA_CB_INFO, *LPNET_EHOME_VOICETALK_DATA_CB_INFO;

typedef BOOL (CALLBACK *VOICETALK_DATA_CB)(LONG lHandle, NET_EHOME_VOICETALK_DATA_CB_INFO *pDataCBInfo, void* pUserData);

typedef struct tagNET_EHOME_VOICETALK_DATA_CB_PARAM
{
    VOICETALK_DATA_CB    fnVoiceTalkDataCB;
    void       *pUserData;
    BYTE       byRes[128];
}NET_EHOME_VOICETALK_DATA_CB_PARAM, *LPNET_EHOME_VOICETALK_DATA_CB_PARAM;

typedef struct tagNET_EHOME_VOICETALK_DATA
{
    BYTE         *pSendBuf;
    DWORD     dwDataLen;
    BYTE        byRes[128];
}NET_EHOME_VOICETALK_DATA, *LPNET_EHOME_VOICETALK_DATA;

NET_DVR_API LONG CALLBACK NET_ESTREAM_StartListenVoiceTalk(LPNET_EHOME_LISTEN_VOICETALK_CFG pListenParam);
NET_DVR_API BOOL CALLBACK NET_ESTREAM_StopListenVoiceTalk(LONG lListenHandle);
NET_DVR_API BOOL CALLBACK NET_ESTREAM_SetVoiceTalkDataCB(LONG lHandle, LPNET_EHOME_VOICETALK_DATA_CB_PARAM pStruCBParam);
NET_DVR_API LONG CALLBACK NET_ESTREAM_SendVoiceTalkData (LONG lHandle, LPNET_EHOME_VOICETALK_DATA pVoicTalkData);
NET_DVR_API BOOL CALLBACK NET_ESTREAM_StopVoiceTalk(LONG lHandle);



NET_DVR_API BOOL CALLBACK NET_ESTREAM_SetSDKLocalCfg(NET_EHOME_LOCAL_CFG_TYPE enumType, void* const lpInBuff);
NET_DVR_API BOOL CALLBACK NET_ESTREAM_GetSDKLocalCfg(NET_EHOME_LOCAL_CFG_TYPE enumType, void *lpOutBuff);


#endif //_HC_EHOME_STREAM_H_
