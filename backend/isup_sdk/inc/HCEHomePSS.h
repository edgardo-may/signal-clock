#ifndef _HC_EHOME_PSS_H_
#define _HC_EHOME_PSS_H_

#include "HCEHomePublic.h"

#define MAX_KMS_USER_LEN    512
#define MAX_KMS_PWD_LEN     512
#define MAX_CLOUD_AK_SK_LEN 64 
#define PSS_CLIENT_FILE_PATH_PARAM_NAME "File-Path"
#define PSS_CLIENT_VRB_FILENAME_CODE "Filename-Code"
#define PSS_CLIENT_KMS_USER_NAME "KMS-Username"
#define PSS_CLIENT_KMS_PASSWIRD "KMS-Password"

enum NET_EHOME_PSS_MSG_TYPE
{
    NET_EHOME_PSS_MSG_TOMCAT = 1,       //Tomcat callback
    NET_EHOME_PSS_MSG_KMS_USER_PWD,     //KMS's username&password callback
    NET_EHOME_PSS_MSG_CLOUD_AK          //EHome5.0 storage protocol's AK callback
};

enum NET_EHOME_PSS_CLIENT_TYPE
{
    NET_EHOME_PSS_CLIENT_TYPE_TOMCAT = 1,       //Tomcat client
    NET_EHOME_PSS_CLIENT_TYPE_VRB,              //VRB client
    NET_EHOME_PSS_CLIENT_TYPE_KMS,              //KMS client
    NET_EHOME_PSS_CLIENT_TYPE_CLOUD             //EHome5.0 storage protocol client
};

//picture server callback param
typedef struct tagNET_EHOME_PSS_TOMCAT_MSG
{
    char szDevUri[MAX_URL_LEN_PSS];       
    DWORD dwPicNum;                         
    char* pPicURLs;                        
    BYTE  byRes[64];
}NET_EHOME_PSS_TOMCAT_MSG, *LPNET_EHOME_PSS_TOMCAT_MSG;

//message callback function
typedef BOOL(CALLBACK *EHomePSSMsgCallBack)(LONG iHandle, NET_EHOME_PSS_MSG_TYPE enumType
    , void *pOutBuffer, DWORD dwOutLen, void *pInBuffer, DWORD dwInLen, void *pUser);

//storage callback function
typedef BOOL(CALLBACK *EHomePSSStorageCallBack)(LONG iHandle, const char* pFileName, void *pFileBuf, DWORD dwFileLen, char *pFilePath, void *pUser);

//listen param
typedef struct tagNET_EHOME_PSS_LISTEN_PARAM
{
    NET_EHOME_IPADDRESS struAddress;  
    char szKMS_UserName[MAX_KMS_USER_LEN];
    char szKMS_Password[MAX_KMS_PWD_LEN];
    EHomePSSStorageCallBack fnPSStorageCb; 
    EHomePSSMsgCallBack    fnPSMsgCb;   
    char szAccessKey[MAX_CLOUD_AK_SK_LEN]; 
    char szSecretKey[MAX_CLOUD_AK_SK_LEN];
    void * pUserData;
    BYTE  byRes[64];
}NET_EHOME_PSS_LISTEN_PARAM, *LPNET_EHOME_PSS_LISTEN_PARAM;

//client param
typedef struct tagNET_EHOME_PSS_CLIENT_PARAM
{
    NET_EHOME_PSS_CLIENT_TYPE enumType; //client type
    NET_EHOME_IPADDRESS struAddress;    
    BYTE  byRes[64];
}NET_EHOME_PSS_CLIENT_PARAM, *LPNET_EHOME_PSS_CLIENT_PARAM;

enum NET_EHOME_PSS_INIT_CFG_TYPE
{
    NET_EHOME_PSS_INIT_CFG_SDK_PATH = 1, //Component library loading path information strucutre, only applicable in Linux
    NET_EHOME_PSS_INIT_CFG_CLOUD_TIME_DIFF         
};

typedef struct tagNET_EHOME_PSS_LOCAL_SDK_PATH{
    char    sPath[MAX_PATH];
    BYTE    byRes[128];
}NET_EHOME_PSS_LOCAL_SDK_PATH, *LPNET_EHOME_PSS_LOCAL_SDK_PATH;

//PSS Library Initialization
NET_DVR_API BOOL  CALLBACK NET_EPSS_Init();
NET_DVR_API BOOL  CALLBACK NET_EPSS_Fini();

//Return the error code.
NET_DVR_API DWORD CALLBACK NET_EPSS_GetLastError();

//log
NET_DVR_API BOOL CALLBACK NET_EPSS_SetLogToFile(LONG iLogLevel, const char *strLogDir, BOOL bAutoDel);

//Get the pss library version
NET_DVR_API DWORD CALLBACK NET_EPSS_GetBuildVersion();


NET_DVR_API LONG CALLBACK NET_EPSS_StartListen(NET_EHOME_PSS_LISTEN_PARAM* pPSSListenParam);

NET_DVR_API BOOL  CALLBACK NET_EPSS_StopListen(LONG lListenHandle);

NET_DVR_API BOOL NET_EPSS_SetSDKInitCfg(NET_EHOME_PSS_INIT_CFG_TYPE enumType, void* const lpInBuff);

NET_DVR_API LONG CALLBACK NET_EPSS_CreateClient(NET_EHOME_PSS_CLIENT_PARAM* pClientParam);

NET_DVR_API BOOL CALLBACK NET_EPSS_ClientSetParam(LONG lHandle, const char* strParamName, const char* strParamVal);

NET_DVR_API BOOL CALLBACK NET_EPSS_ClientDoUpload(LONG lHandle, char* strUrl, LONG dwUrlLen);

NET_DVR_API BOOL CALLBACK NET_EPSS_DestroyClient(LONG lHandle);
#endif //_HC_EHOME_PSS_H_