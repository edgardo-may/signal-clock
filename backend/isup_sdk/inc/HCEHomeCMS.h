#ifndef _HC_EHOME_CMS_H_
#define _HC_EHOME_CMS_H_

#include "HCEHomePublic.h"


//SDK Initialization
NET_DVR_API BOOL  CALLBACK NET_ECMS_Init();
//De-initialize SDK and release resource
NET_DVR_API BOOL  CALLBACK NET_ECMS_Fini();

NET_DVR_API DWORD CALLBACK NET_ECMS_GetLastError();

//Get the CMS library version
NET_DVR_API DWORD CALLBACK NET_ECMS_GetBuildVersion();


typedef enum tagNET_EHOME_REGISTER_TYPE{
    ENUM_UNKNOWN = -1,   
    ENUM_DEV_ON = 0,                     //Callback Device Online 
    ENUM_DEV_OFF,                        //Callback Device Offline 
    ENUM_DEV_ADDRESS_CHANGED,            //Device Address Changed 
    ENUM_DEV_AUTH,               //Ehome5.0 device auth callback
    ENUM_DEV_SESSIONKEY,         //Ehome5.0 device sessionkey callback
    ENUM_DEV_DAS_REQ             //Ehome5.0 device's request of das's info
}NET_EHOME_REGISTER_TYPE;

//TALK Encoding type
typedef enum tagNET_EHOME_TALK_ENCODING_TYPE{
    ENUM_ENCODING_START = 0,            //encoding start
    ENUM_ENCODING_G722_1,               //G722_1
    ENUM_ENCODING_G711_MU,              //G711_MU
    ENUM_ENCODING_G711_A,               //G711_A
    ENUM_ENCODING_G723,                 //G723
    ENUM_ENCODING_MP1L2,                //MP1L2
    ENUM_ENCODING_MP2L2,                //MP2L2
    ENUM_ENCODING_G726,                 //G726
    ENUM_ENCODING_AAC,                  //AAC
    ENUM_ENCODING_RAW = 100             //RAW
}NET_EHOME_TALK_ENCODING_TYPE;

typedef BOOL (CALLBACK * DEVICE_REGISTER_CB)(LONG lUserID, DWORD dwDataType, void *pOutBuffer, DWORD dwOutLen, 
                                                 void *pInBuffer, DWORD dwInLen, void *pUser);

typedef struct tagNET_EHOME_CMS_LISTEN_PARAM
{
    NET_EHOME_IPADDRESS struAddress;  //Local Listen Information, when IP is 0.0.0.0，it is local address by default; when with multiple NICs, it is the first one got from the operating system by default 
    DEVICE_REGISTER_CB  fnCB; //Device Register Callback Function 
    void * pUserData;   // User Data 
    BYTE  byRes[32]; 
}NET_EHOME_CMS_LISTEN_PARAM, *LPNET_EHOME_CMS_LISTEN_PARAM;

//start stop listen
NET_DVR_API LONG CALLBACK NET_ECMS_StartListen(LPNET_EHOME_CMS_LISTEN_PARAM lpCMSListenPara);
NET_DVR_API BOOL CALLBACK NET_ECMS_StopListen(LONG iHandle);
//device logout
NET_DVR_API BOOL CALLBACK NET_ECMS_ForceLogout(LONG lUserID);
NET_DVR_API BOOL CALLBACK NET_ECMS_SetLogToFile(DWORD iLogLevel, char *strLogDir, BOOL bAutoDel);

#define FIRMWARE_VER_LEN 24
#define CODE_LEN   8
#define MAX_DEVNAME_LEN 32

typedef struct tagNET_EHOME_DEV_REG_INFO
{
    DWORD  dwSize; 
    DWORD  dwNetUnitType;            //Reserved, invalid
    BYTE   byDeviceID[MAX_DEVICE_ID_LEN]; //Device Registered ID 
    BYTE   byFirmwareVersion[24];    //Firmware Version
    NET_EHOME_IPADDRESS struDevAdd;         //Device Local Address in registration 
    DWORD  dwDevType;                  //Device Type 
    DWORD  dwManufacture;              //Device Manufacture Code 
    BYTE   byPassWord[32];             //Password when loging in CMS, verified by user according to requirement
    BYTE   sDeviceSerial[NET_EHOME_SERIAL_LEN/*12*/];    //device digital serial
    BYTE   byReliableTransmission;
    BYTE   byWebSocketTransmission;
    BYTE   bySupportRedirect;    //Support redirect 0-not support 1-support
    BYTE   byDevProtocolVersion[6];
    BYTE   bySessionKey[MAX_MASTER_KEY_LEN];//Ehome5.0 device's SessionKey
    BYTE   byRes[27];
}NET_EHOME_DEV_REG_INFO, *LPNET_EHOME_DEV_REG_INFO;

typedef struct tagNET_EHOME_DEV_REG_INFO_V12
{
    NET_EHOME_DEV_REG_INFO struRegInfo;
    NET_EHOME_IPADDRESS struRegAddr;         //register server ip
    BYTE   sDevName[MAX_DEVNAME_LEN]; /*device's name*/
    BYTE   byRes[224];
}NET_EHOME_DEV_REG_INFO_V12, *LPNET_EHOME_DEV_REG_INFO_V12;

typedef struct tagNET_EHOME_BLACKLIST_SEVER
{
    NET_EHOME_IPADDRESS struAdd;          //Server Address 
    BYTE    byServerName[NAME_LEN/*32*/];       //Server Name
    BYTE    byUserName[NAME_LEN/*32*/];             //user name
    BYTE    byPassWord[NAME_LEN/*32*/];             //password
    BYTE    byRes[64];
}NET_EHOME_BLACKLIST_SEVER, *LPNET_EHOME_BLACKLIST_SEVER;

typedef struct tagNET_EHOME_SERVER_INFO
{
    DWORD                  dwSize;
    DWORD                  dwKeepAliveSec;            //Heartbeat Interval (second), 15s by default
    DWORD                  dwTimeOutCount;         //Heartbeat Timeout Times, value 0 by default (6 times) 
    NET_EHOME_IPADDRESS    struTCPAlarmSever;      //Alarm Server Address (TCP protocol) 
    NET_EHOME_IPADDRESS    struUDPAlarmSever;        //Alarm Server Address (UDP protocol)
    DWORD                  dwAlarmServerType;        //Alarm Server Type: 0- UDP protocol supported only, 1- UDP and TCP protocols supported 
    NET_EHOME_IPADDRESS    struNTPSever;            //NTP Server Address 
    DWORD                  dwNTPInterval;            //NTP Interval (second) 
    NET_EHOME_IPADDRESS    struPictureSever;       //Picture Server Address 
    DWORD                  dwPicServerType;        //Picture Server Type: 1- VRB Picture Server, 0- Tomcat Picture Server 
    NET_EHOME_BLACKLIST_SEVER   struBlackListServer;    //Blacklist Server 
    BYTE                   byRes[128];
}NET_EHOME_SERVER_INFO, *LPNET_EHOME_SERVER_INFO;

typedef struct tagNET_EHOME_SERVER_INFO_V50
{
    DWORD                  dwSize;
    DWORD                  dwKeepAliveSec;            //Heartbeat Interval (second), 15s by default
    DWORD                  dwTimeOutCount;         //Heartbeat Timeout Times, value 0 by default (6 times) 
    NET_EHOME_IPADDRESS    struTCPAlarmSever;      //Alarm Server Address (TCP protocol) 
    NET_EHOME_IPADDRESS    struUDPAlarmSever;        //Alarm Server Address (UDP protocol)
    DWORD                  dwAlarmServerType;        //Alarm Server Type: 0- UDP protocol supported only, 1- UDP and TCP protocols supported 
    NET_EHOME_IPADDRESS    struNTPSever;            //NTP Server Address 
    DWORD                  dwNTPInterval;            //NTP Interval (second) 
    NET_EHOME_IPADDRESS    struPictureSever;       //Picture Server Address 
    DWORD                  dwPicServerType;        //Picture Server Type: 1- VRB Picture Server, 0- Tomcat Picture Server 
    NET_EHOME_BLACKLIST_SEVER   struBlackListServer;    //Blacklist Server 
    NET_EHOME_IPADDRESS         struRedirectSever;       //Redirect Server
    BYTE                        byRes[512];
}NET_EHOME_SERVER_INFO_V50, *LPNET_EHOME_SERVER_INFO_V50;

//voice talk
typedef void(CALLBACK *fVoiceDataCallBack)(LONG iVoiceHandle, char *pRecvDataBuffer, DWORD dwBufSize, DWORD dwEncodeType, BYTE byAudioFlag, void* pUser);

typedef    struct tagNET_EHOME_VOICETALK_PARA
{
    BOOL           bNeedCBNoEncData;
    fVoiceDataCallBack  cbVoiceDataCallBack; 
    DWORD          dwEncodeType;    //0- OggVorbis，1-G711U，2-G711A，3-G726，4-AAC，5-MP2L2，6-PCM
    void*          pUser;
    BYTE           byVoiceTalk;
    BYTE           byRes[63];//Reserved, set as 0. 0
}NET_EHOME_VOICETALK_PARA,*LPNET_EHOME_VOICETALK_PARA;

typedef struct tagNET_EHOME_VOICE_TALK_IN
{
    DWORD dwVoiceChan;                                          //Channel Number
    NET_EHOME_IPADDRESS struStreamSever;                        //Addr of Stream Server
    NET_EHOME_TALK_ENCODING_TYPE  byEncodingType[9];            //encoding type
    BYTE  byRes[119];
}NET_EHOME_VOICE_TALK_IN, *LPNET_EHOME_VOICE_TALK_IN;

typedef struct tagNET_EHOME_VOICE_TALK_OUT
{
    LONG   lSessionID;  
    BYTE  byRes[128];
}NET_EHOME_VOICE_TALK_OUT, *LPNET_EHOME_VOICE_TALK_OUT;

typedef struct tagNET_EHOME_PUSHVOICE_IN
{
    DWORD dwSize;
    LONG   lSessionID; 
    BYTE  byToken[64];
    BYTE  byRes[64];
}NET_EHOME_PUSHVOICE_IN, *LPNET_EHOME_PUSHVOICE_IN;

typedef struct tagNET_EHOME_PUSHVOICE_OUT
{
    DWORD dwSize;
    BYTE  byRes[128];
}NET_EHOME_PUSHVOICE_OUT, *LPNET_EHOME_PUSHVOICE_OUT;

NET_DVR_API LONG CALLBACK  NET_ECMS_StartVoiceTalk(LONG lUserID, DWORD dwVoiceChan, 
                                                   const NET_EHOME_VOICETALK_PARA    *pVoiceTalkPara);

NET_DVR_API BOOL CALLBACK   NET_ECMS_StartVoiceWithStmServer(LONG lUserID, NET_EHOME_VOICE_TALK_IN *lpVoiceTalkIn, NET_EHOME_VOICE_TALK_OUT *lpVoiceTalkOut);
NET_DVR_API BOOL CALLBACK   NET_ECMS_StartPushVoiceStream(LONG lUserID, LPNET_EHOME_PUSHVOICE_IN lpPushParamIn, LPNET_EHOME_PUSHVOICE_OUT lpPushParamOut);
NET_DVR_API BOOL CALLBACK   NET_ECMS_StopVoiceTalk(LONG iVoiceHandle);
NET_DVR_API BOOL CALLBACK   NET_ECMS_StopVoiceTalkWithStmServer(LONG lUserID, LONG lSessionID);
NET_DVR_API BOOL CALLBACK   NET_ECMS_SendVoiceTransData(LONG iVoiceHandle, const char *pSendBuf, DWORD dwBufSize);

bool NET_EHOME_ClientAudioStart(fVoiceDataCallBack cbVoiceDataCallBack, void *pUser);


typedef    struct    tagNET_EHOME_CONFIG
{
    void*        pCondBuf;    //[in]，Condition parameters (structure format), such as channel No., can be NULL. 
    DWORD        dwCondSize; //[in]，The size of condition parameters buffer 
    void*        pInBuf;        //[in]，Input parameters ( structure format), the value is NULL while being obtained, other values on settings. 
    DWORD        dwInSize;    //[in], The buffer size of the input parameters
    void*        pOutBuf;        //[out]，Output parameters ( structure format), the value is NULL while being obtained, other values on settings. 
    DWORD        dwOutSize;    //[in]，The buffer size of output parameters  
    BYTE        byRes[40];    //Reserved, set as 0. 0 
}NET_EHOME_CONFIG, *LPNET_EHOME_CONFIG;

typedef struct tagNET_EHOME_XML_CFG 
{
    void*     pCmdBuf;    //String format command 
    DWORD      dwCmdLen;   //The length of string format command 
    void*     pInBuf;     //Input data
    DWORD      dwInSize;   //The size of input buffer 
    void*     pOutBuf;    //Output parameters 
    DWORD      dwOutSize;  //The size of output buffer 
    DWORD      dwSendTimeOut;  //Data sending over-time, unit:ms, default:5s 
    DWORD      dwRecvTimeOut;  //Data receiving over-time, unit:ms, default:5s 
    void*     pStatusBuf;     //return status(XML format),if not need,set NULL
    DWORD      dwStatusSize;   //the size of status buf
    BYTE       byRes[24];
}NET_EHOME_XML_CFG, *LPNET_EHOME_XML_CFG;

#define    MAX_SERIALNO_LEN        128    
#define  MAX_PHOMENUM_LEN        32
#define    MAX_DEVICE_NAME_LEN        32

typedef struct tagNET_DVR_DVR_TYPE_NAME
{
    DWORD dwDVRType;
    char byDevName[24];  
}NET_DVR_TYPE_NAME;

static const NET_DVR_TYPE_NAME DVRTypeName[] = 
{
    {0,"UNKNOWN TYPE"},      
    {1,"DVR"},                    /*DVR*/    
    {2,"ATMDVR"},                /*atm dvr*/
    {3,"DVS"},                /*DVS*/
    {4,"DEC"},                /* 6001D */
    {5,"ENC_DEC"},                /* 6001F */
    {6,"DVR_HC"},                /*8000HC*/
    {7,"DVR_HT"},                /*8000HT*/
    {8,"DVR_HF"},                /*8000HF*/
    {9,"DVR_HS"},                /* 8000HS DVR(no audio) */
    {10,"DVR_HTS"},              /* 8016HTS DVR(no audio) */
    {11,"DVR_HB"},              /* HB DVR(SATA HD) */
    {12,"DVR_HCS"},              /* 8000HCS DVR */
    {13,"DVS_A"},              /* DVS with ATA */
    {14,"DVR_HC_S"},              /* 8000HC-S */
    {15,"DVR_HT_S"},              /* 8000HT-S */
    {16,"DVR_HF_S"},              /* 8000HF-S */
    {17,"DVR_HS_S"},              /* 8000HS-S */
    {18,"ATMDVR_S"},              /* ATM-S */
    {19,"DVR_7000H"},                /*7000H*/
    {20,"DEC_MAT"},              /*multiple decoder*/
    {21,"DVR_MOBILE"},                /* mobile DVR */                 
    {22,"DVR_HD_S"},              /* 8000HD-S */
    {23,"DVR_HD_SL"},                /* 8000HD-SL */
    {24,"DVR_HC_SL"},                /* 8000HC-SL */
    {25,"DVR_HS_ST"},                /* 8000HS_ST */
    {26,"DVS_HW"},              /* 6000HW */
    {27,"DS630X_D"},             /* multiple decoder */
    {28,"DS640X_HD"},                /*640X HD decoder*/
    {29,"DS610X_D"},              /*610X decoder*/
    {30,"IPCAM"},                /*IP camera*/
    {31,"MEGA_IPCAM"},                /*high-definition IP camera 852F&852MF*/
    {32,"IPCAM_862MF"},                /*862MF for 9000*/
    {35,"ITCCAM"},                /*Intelligent HD IP camera*/
    {36,"IVS_IPCAM"},          /*Intelligent analyze HD IP camera*/
    {38,"ZOOMCAM"},            /*Integrated machine*/
    {40,"IPDOME"},              /*IP camera*/
    {41,"IPDOME_MEGA200"},              /*2million HD IP speed dome camera*/
    {42,"IPDOME_MEGA130"},              /*IP 1.3million HD speed dome camera*/
    {43,"IPDOME_AI"},              /*IP HD Intelligent speed dome camera*/ 
    {44,"TII_IPCAM"},          /*speed dome camera with infrared thermal imaging*/
    {50,"IPMOD"},                /*IP mode*/
    {59,"DS64XXHD_T"},                //64-T HD decoder
    {60,"IDS6501_HF_P"},    // 6501 licence plates
    {61,"IDS6101_HF_A"},              //Intelligent ATM
    {62,"IDS6002_HF_B"},          //two camera to tracking：DS6002-HF/B
    {63,"IDS6101_HF_B"},          //behavior analyze：DS6101-HF/B
    {64,"IDS52XX"},          //Intelligent analyzer IVMS
    {65,"IDS90XX"},                // 9000 Intelligent
    {67,"IDS8104_AHL_S_H"},              //ATM with Face recognition
    {68,"IDS91XX"},                // 9100 Intelligent
    {69,"IIP_CAM_B"},  //Intelligent analyze IP camera
    {70,"IIP_CAM_F"},  //Intelligent face IP camera
    {71,"DS71XX_H"},                /* DS71XXH_S */
    {72,"DS72XX_H_S"},                /* DS72XXH_S */
    {73,"DS73XX_H_S"},                /* DS73XXH_S */
    {74,"DS72XX_HF_S"},              //DS72XX_HF_S
    {75,"DS73XX_HFI_S"},              //DS73XX_HFI_S
    {75,"DS73XX_HF_S"},              //DS73XX_HF_S
    {76,"DS76XX_H_S"},                /* DVR,e.g. DS7604_HI_S */
    {77,"DS76XX_N_S"},                /* NVR,e.g. DS7604_NI_S */
    {81,"DS81XX_HS_S"},                /* DS81XX_HS_S */
    {82,"DS81XX_HL_S"},                /* DS81XX_HL_S */
    {83,"DS81XX_HC_S"},                /* DS81XX_HC_S */
    {84,"DS81XX_HD_S"},                /* DS81XX_HD_S */
    {85,"DS81XX_HE_S"},                /* DS81XX_HE_S */
    {86,"DS81XX_HF_S"},                /* DS81XX_HF_S */
    {87,"DS81XX_AH_S"},                /* DS81XX_AH_S */
    {88,"DS81XX_AHF_S"},                /* DS81XX_AHF_S */
    {90,"DS90XX_HF_S"},              /*DS90XX_HF_S*/
    {91,"DS91XX_HF_S"},              /*DS91XX_HF_S*/
    {92,"DS91XX_HD_S"},              /*91XXHD-S(MD)*/
    {93,"IDS90XX_A"},                // 9000 Intelligent ATM
    {94,"IDS91XX_A"},                // 9100 Intelligent ATM
    {95,"DS95XX_N_S"},              /*DS95XX_N_S NVR without output*/
    {96,"DS96XX_N_SH"},              /*DS96XX_N_SH NVR*/
    {97,"DS90XX_HF_SH"},              /*DS90XX_HF_SH */   
    {98,"DS91XX_HF_SH"},              /*DS91XX_HF_SH */
    {100,"DS_B10_XY"},             /*Video platform device type (X:the number of coders，Y: the number of decoder)*/
    {101,"DS_6504HF_B10"},             /*inter coder of video platform*/
    {102,"DS_6504D_B10"},             /*inter decoder of video platform*/
    {103,"DS_1832_B10"},             /*inter code divider of video platform*/
    {104,"DS_6401HFH_B10"},             /*inter fiber board of video platform*/
    {105,"DS_65XXHC"},                //65XXHC DVS
    {106,"DS_65XXHC_S"},                //65XXHC-SATA DVS
    {107,"DS_65XXHF"},                //65XXHF DVS
    {108,"DS_65XXHF_S"},                //65XXHF-SATA DVS
    {109,"DS_6500HF_B"},             //65 rack DVS
    {110,"IVMS_6200_C"},            // iVMS-6200(/C)  
    {111,"IVMS_6200_B"},             // iVMS-6200(/B)
    {112,"DS_72XXHV_ST"},                //72XXHV_ST15 DVR
    {113,"DS_72XXHV_ST"},                //72XXHV_ST20 DVR
    {114,"IVMS_6200_T"},             // IVMS-6200(/T)
    {115,"IVMS_6200_BP"},             // IVMS-6200(/BP)
    {116,"DS_81XXHC_ST"},                //DS_81XXHC_ST
    {117,"DS_81XXHS_ST"},                //DS_81XXHS_ST
    {118,"DS_81XXAH_ST"},                //DS_81XXAH_ST
    {119,"DS_81XXAHF_ST"},                //DS_81XXAHF_ST
    {120,"DS_66XXDVS"},                //66XX DVS
    {121,"DS_1964_B10"},             /*inter alarmer of video platform*/
    {122,"DS_B10N04_IN"},             /*inter cascade input of video platform*/
    {123,"DS_B10N04_OUT"},             /*inter cascade output of video platform*/
    {124,"DS_B10N04_INTEL"},             /*inter intelligent of video platform*/
    {125,"DS_6408HFH_B10E_RM"},             //V6 HD
    {126,"DS_B10N64F1_RTM"},             //V6 cascade without DSP
    {127,"DS_B10N64F1D_RTM"},             //V6 cascade with DSP
    {128,"DS_B10_SDS"},             //children domain controller of video platform
    {129,"DS_B10_DS"},             //domain controller of video platform
    {130,"DS_6401HFH_B10V"},             //VGA HD coder
    {131,"DS_6504D_B10B"},             /*inter SDTV decoder of video platform*/
    {132,"DS_6504D_B10H"},             /*iner HD decoder of video platform*/
    {133,"DS_6504D_B10V"},             /*inter VGA decoder of video platform*/
    {134,"DS_6408HFH_B10S"},             //video platform SDI 
    {135,"DS_18XX_N"},             /* Matrix access gateway*/ 
    {141,"DS_18XX_PTZ"},                /*IP code divider*/
    {142,"DS_19AXX"},                /*general alarm host*/
    {143,"DS_19BXX"},                /*household alarm host*/
    {144,"DS_19CXX"},                /*ATM alarm host*/
    {145,"DS_19DXX"},                /*alarm host with dynamic environment monitoring*/    
    {146,"DS_19XX"},             /*1900 alarm host*/ 
    {147,"DS_19SXX"},                /*video alarm host*/
    {148, "DS_1HXX"},            /*CS*/ //security cabin
    /**********************device type end***********************/
    {161,"DS_C10H"},           /*multiple screen controller*/
    {162,"DS_C10N_BI"},            //BNC processor
    {163,"DS_C10N_DI"},            //rbg processor
    {164,"DS_C10N_SI"},            //stream processor
    {165,"DS_C10N_DO"},            //display processor
    {166,"DS_C10N_SERVER"},        //distributed server
    {171,"IDS_8104_AHFL_S_H"},             // 8104ATM 
    {172,"IDS_65XX_HF_A"},             // 65 ATM
    {173,"IDS90XX_HF_RH"},             // 9000 intelligent RH
    {174,"IDS91XX_HF_RH"},             // 9100 intelligent RH
    {175,"IDS_65XX_HF_B"},             // 65 behavior analyze
    {176,"IDS_65XX_HF_P"},             // 65 license plate recognition
    {177,"IVMS_6200_F"},     // IVMS-6200(/F)
    {178,"IVMS_6200_A"},             //iVMS-6200(/A)
    {179,"IVMS_6200_F_S"},   //iVMS-6200(/F_S)
    {181,"DS90XX_HF_RH"},             // 9000 RH
    {182,"DS91XX_HF_RH"},             // 9100 RH
    {183,"DS78XX_S"},             // 78
    {185,"DS81XXHW_S"},                // 81 Resolution 960 
    {186,"DS81XXHW_ST"},             // DS81XXHW_ST
    {187,"DS91XXHW_ST"},             // DS91XXHW_ST
    {188,"DS91XX_ST"},             // DS91XX_ST
    {189,"DS81XX_ST"},             // DS81XX_ST
    {190,"DS81XXH_ST"},             // DS81XXHDI_ST,DS81XXHE_ST ky2012
    {191,"DS73XXH_ST"},             // DS73XXHI_ST ky2012
    {192,"DS81XX_SH"},             // trial 81SH,81SHF
    {193,"DS81XX_SN"},             // trial 81SNL
    {194,"DS96XXN_ST"},             //NVR:DS96xxN_ST
    {195,"DS86XXN_ST"},             //NVR:DS86xxN_ST
    {196,"DS80XXHF_ST"},             //DVR:DS80xxHF_ST
    {197,"DS90XXHF_ST"},             //DVR:DS90xxHF_ST
    {198,"DS76XXN_ST"},             //NVR:DS76xxN_ST
    {199,"DS_9664N_RX"},         //NVR flushbonading(wiht 64 IP channel，with out analog channel)，last X：T/H    
    {200,"ENCODER_SERVER"},            // coding card server 
    {201,"DECODER_SERVER"},         // decoding server
    {202,"PCNVR_SERVER"},         // PCNVR
    {203,"CVR_SERVER"},         // Barnes&Noble CVR type:DVR_S-1
    {204,"DS_91XXHFH_ST"},         // 91 HD-SDI HD DVR
    {205,"DS_66XXHFH"},         // 66 HD decoder    
    {210,"TRAFFIC_TS_SERVER"},         //terminal Server
    {211,"TRAFFIC_VAR"},         //Analysis of video recorder
    {212,"IPCALL"},              //IP Video intercom
};

/**********************Device Class begin**********************/

/* dvr 1-50 */
#define DEV_CLASS_DVR      1          //dvr 
#define DEV_CLASS_INTERROGATION  2    //Interrogation
#define DEV_CLASS_SIMPLE_TRAIL  3    //simple trail
#define DEV_CLASS_TRAIL  4           //trail
#define DEV_CLASS_RECORD_PLAY  5     //record play
#define DEV_CLASS_ATM 6           //ATM

/* dvs 51-100 */
#define DEV_CLASS_DVS 51          //dvs

/* nvr 101-150 */
#define DEV_CLASS_NVR 101          //nvr

/* ipc 151-200 */
#define DEV_CLASS_GUN 151          //ipc gun
#define DEV_CLASS_BALL 152          //ipc ball
#define DEV_CLASS_SNAP 153          //snap
#define DEV_CLASS_INTELLI_TILT 154   //intrllt tilt
#define DEV_CLASS_FISH_EYE 155          //fish eye
#define DEV_CLASS_2DP_Z 156         //2DP_Z
#define DEV_CLASS_2DP 157   //2DP
#define DEV_CLASS_PT 158   //PT
#define DEV_CLASS_TRI 159   //TRI

/* CVR 201 - 250*/
#define DEV_CLASS_CVR 201          //CVR

/* Transfer & Display 251 - 300*/
#define DEV_CLASS_B20 251          //B20
#define DEV_CLASS_B10 252          //B10
#define DEV_CLASS_DECODER 253      //DECODER
#define DEV_CLASS_MATRIXMANAGEDEVICE 254      //MATRIXMANAGEDEVICE
#define DEV_CLASS_OTICAL 255      //OTICA
#define DEV_CLASS_CODESPITTER 256      //CODESPITTER
#define DEV_CLASS_ALARMHOST 257      //ALARMHOST
#define DEV_CLASS_MOVING_RING 258      //MOVING_RING
#define DEV_CLASS_CVCS 259      //CVCS
#define DEV_CLASS_DVCS 260      //DVCS
#define DEV_CLASS_TRANSCODER 261      //TRANSCODER
#define DEV_CLASS_LCD_SCREEN 262      //LCD SCREEN
#define DEV_CLASS_LED_SCREEN 263      //LED SCREEN
#define DEV_CLASS_MATRIX 264      //MATRIX
#define DEV_CLASS_CONFERENCE_SYSTEM 265      //CONFERENCE_SYSTEM
#define DEV_CLASS_INFORMATION_RELEASE_EQUIPMENT  266      // Information release equipment 
#define DEV_CLASS_NET_GAP 267      //net gap
#define DEV_CLASS_MERGE 268      //merge
#define DEV_CLASS_REAR_PROJECTION 269      //rear projection
#define DEV_CLASS_SWITCH 270      //switch
#define DEV_CLASS_FIBER_CONVERTER 271      //fiber converter
#define DEV_CLASS_SCREEN_SERVER 272      //screen server
#define DEV_CLASS_SCE_SERVER 273      //SCE server
#define DEV_CLASS_WIRELESS_TRANS  274    //wireless transmission equipment
#define DEV_CLASS_Y10_SERIES      275    //Y10 series
#define DEV_CLASS_SAFETY_MAVHINE  276    //safety mavhine
#define DEV_CLASS_IOTGATEWAY 277    //IOT gateway
/* ALARM 301 - 350*/
#define DEV_CLASS_VIDEO_ALARM_HOST 301          //video alarm host
#define DEV_CLASS_NET_ALARM_HOST 302          //net alarm host
#define DEV_CLASS_ONE_KEY_ALARM 303      //one key alarm
#define DEV_CLASS_WIRELESS_ALARM_HOST 304      //wireless alarm host
#define DEV_CLASS_ALARM_MODULE 305      //Alarm MOdule
#define DEV_CLASS_HOME_ALARM_HOST 306      //home alarm host

/* access control 351 - 400*/
#define DEV_CLASS_ACCESS_CONTROL 351          //access control

/* video intercom 401 - 450*/
#define DEV_CLASS_VIDEO_INTERCOM 401          //video intercom

/* UNNanned aerial vehicle 451 - 500*/
#define DEV_CLASS_UMMANNED_AERIAL_VEHICLE 451          //UNNanned aerial vehicle

/* mobile: 501-550*/
#define DEV_CLASS_MOBILE 501          //mobile

/* mobile vehicle: 551-600*/
#define DEV_CLASS_MOBILE_VEHICLE 551          //mobile vehicle

//Intelligent analyzer :601-650
#define DEV_CLASS_INTELLIGENT_ANALYZER 601  //Intelligent analyzer 

//Intelligent traffic server :651-700
#define DEV_CLASS_INTELLIGENT_TRAFFIC_SERVER 651  //Intelligent traffic server 
#define DS_TP2200_EC                         652  //

/* nvs 701-750 */
#define DEV_CLASS_NVS 701          //nvs

/*RFID 751-800*/
#define DS_TRI21A_1_P 751   //RFID

/* 801-850 */
#define DS_CLASS_FA              801 
#define DS_CLASS_PURE            802 
#define DS_CLASS_FS              803
#define DS_CLASS_FD              804
#define DS_CLASS_HAWK            805
#define DS_CLASS_BLADE           806
#define DS_CLASS_HMCP            807

/* smartlock 851 - 900*/
#define DEV_CLASS_SMART_LOCK     851

/* radar 901 - 950*/
#define DEV_CLASS_RADAR          901

/*panorama detail camera:8451-8470*/
#define iDS_PT              8451  //panorama detail camera

/* other class 65534 */
#define DEV_CLASS_DEFAULT 65534   //default
/**********************Device Class end**********************/

typedef struct tagNET_EHOME_DEVICE_INFO
{
    DWORD        dwSize;                
    DWORD        dwChannelNumber;     //The number of analog camera 
    DWORD        dwChannelAmount;    //Total number of camera (analog & network) 
    DWORD        dwDevType;            //Device type: 1- DVR，3- DVS，30- IPC，40- IPDOME 
    DWORD        dwDiskNumber;        //Current HDD number 
    BYTE        sSerialNumber[MAX_SERIALNO_LEN];        //Serial number 
    DWORD        dwAlarmInPortNum;    //Analog channel alarm input number 
    DWORD        dwAlarmInAmount;    //Total alarm inout number 
    DWORD        dwAlarmOutPortNum;    //Analog channel alarm output number 
    DWORD        dwAlarmOutAmount;    //Total alarm output number 
    DWORD        dwStartChannel;        //The initial video channel No. 
    DWORD        dwAudioChanNum;    //Voice talk channel No. 
    DWORD        dwMaxDigitChannelNum;    //The Max. channel No. supported by the device 
    DWORD        dwAudioEncType;        //Audio format of the voice talk，0- OggVorbis，1-G711U，2-G711A，3-G726，4-AAC，5-MP2L2,6-PCM
    BYTE        sSIMCardSN[MAX_SERIALNO_LEN];    //Vehicle device expending, serial No. of the SIM card 
    BYTE        sSIMCardPhoneNum[MAX_PHOMENUM_LEN];    //Vehicle device expending, phone No. of the the SIM card 
    DWORD        dwSupportZeroChan;    // Supported zero channel number, 0- not support, 1- support 1 , 2- support 2, and so forth. 
    DWORD        dwStartZeroChan;        //The initial No. of the zero channel, default: 10000
    DWORD        dwSmartType;            //Intelligent type, 0- Smart(default), 1- professional 
    WORD        wDevClass;             //Device Class
    BYTE        byRes[158];            
}NET_EHOME_DEVICE_INFO,*LPNET_EHOME_DEVICE_INFO;

#define    MAX_VERSION_LEN            32 
typedef struct tagNET_EHOME_VERSION_INFO
{
    DWORD        dwSize;                
    BYTE        sSoftwareVersion[MAX_VERSION_LEN];    //Main control version 
    BYTE        sDSPSoftwareVersion[MAX_VERSION_LEN];//Encoding version 
    BYTE        sPanelVersion[MAX_VERSION_LEN];    //Panel version 
    BYTE        sHardwareVersion[MAX_VERSION_LEN];    //HDD version 
    BYTE        byRes[124];
}NET_EHOME_VERSION_INFO,*LPNET_EHOME_VERSION_INFO;

typedef struct tagNET_EHOME_DEVICE_CFG
{
    DWORD        dwSize;                
    BYTE        sServerName[MAX_DEVICE_NAME_LEN];    //Device name 
    DWORD        dwServerID;            //Device No.( remote control No.:0~255) 
    DWORD        dwRecycleRecord;        //Loop recording? 0- No, 1- Yes 
    DWORD        dwServerType;        //Device type:1- DVR，3- DVS，30- IPC，40- IPDOME 
    DWORD        dwChannelNum;        //Channel number, including analog and network(read only)channel 
    DWORD        dwHardDiskNum;        //HDD number (read only) 
    DWORD        dwAlarmInNum;        //Alarm input number(analog channel) (read only) 
    DWORD        dwAlarmOutNum;        //Alarm output number(analog channel) (read only) 
    DWORD        dwRS232Num;        //RS232 serial port number (read only) 
    DWORD        dwRS485Num;        //RS485 serial port number (read only) 
    DWORD        dwNetworkPortNum;    //Network port number (read only) 
    DWORD        dwAuxoutNum;        //Auxiliary port number (read only) 
    DWORD        dwAudioNum;        //Audio interface number (read only) 
    BYTE        sSerialNumber[MAX_SERIALNO_LEN];    //Device serial No. (read only) 
    DWORD        dwMajorScale;        //Major scaling, 0- disable, 1- enable 
    DWORD        dwMinorScale;        //Auxiliary scaling,0- disable, 1- enable 
    BYTE        byRes[292];    
}NET_EHOME_DEVICE_CFG,*LPNET_EHOME_DEVICE_CFG;

#define    NET_EHOME_GET_DEVICE_INFO        1    
#define    NET_EHOME_GET_VERSION_INFO    2
#define    NET_EHOME_GET_DEVICE_CFG        3    
#define    NET_EHOME_SET_DEVICE_CFG        4

#define NET_EHOME_GET_GPS_CFG 20 //get GPS
#define NET_EHOME_SET_GPS_CFG 21 //set GPS
#define NET_EHOME_GET_PIC_CFG 22 //get OSD 
#define NET_EHOME_SET_PIC_CFG 23 //set OSD
#define NET_EHOME_GET_WIRELESSINFO_CFG 24 //get wireless info
#define NET_EHOME_SET_WIRELESSINFO_CFG 25 //set wireless info

#define MAX_EHOME_PROTOCOL_LEN  1500

typedef struct tagNET_EHOME_REMOTE_CTRL_PARAM
{
    DWORD dwSize;
    void *lpCondBuffer;        
    DWORD  dwCondBufferSize;    
    void *lpInbuffer;          
    DWORD  dwInBufferSize;   
    BYTE   byRes[32];
}NET_EHOME_REMOTE_CTRL_PARAM, *LPNET_EHOME_REMOTE_CTRL_PARAM;

typedef struct tagNET_EHOME_GPS_CFG
{
    DWORD        dwSize;
    DWORD        dwTransInterval;    
    DWORD        dwMaxSpeed;        
    DWORD        dwMinSpeed;        
    BYTE         bEnable;           
    BYTE         byRes[63]; 
 }NET_EHOME_GPS_CFG, *LPNET_EHOME_GPS_CFG;

typedef struct tagNET_EHOME_PIC_CFG
{
    DWORD        dwSize;
    BYTE            byChannelName[NAME_LEN];
    BOOL            bIsShowChanName;
    WORD            wChanNameXPos;
    WORD            wChanNameYPos;
    BOOL            bIsShowOSD;
    WORD            wOSDXPos;
    WORD            wOSDYPos;
    BYTE            byOSDType;
    BYTE            byOSDAtrib;
    BYTE            byRes1[2];
    BOOL            bIsShowWeek;
    BYTE            byRes2[64];
}NET_EHOME_PIC_CFG, *LPNET_EHOME_PIC_CFG;

typedef struct tagNET_EHOME_WIRELESS_INFO_CFG
{
    DWORD        dwSize;
    DWORD        dwInfoTransInterval; //upload interval,unit:second
    BYTE         byEnable; //enble
    BYTE         byRes[47];
}NET_EHOME_WIRELESS_INFO_CFG, *LPNET_EHOME_WIRELESS_INFO_CFG;

typedef struct tagNET_CMS_ISAPI_CONFIG
{
    DWORD    dwSize;
    void     *lpRequestUrl;
    DWORD    dwRequestUrlLen;
    void     *lpInBuffer;
    DWORD    dwInBufferSize;
    void     *lpOutBuffer;
    DWORD    dwOutBufferSize;
    DWORD    dwReturnedSize;
    DWORD    dwRecvTimeOut;
    BYTE     byRes[32];
}NET_CMS_ISAPI_CONFIG, *LPNET_CMS_ISAPI_CONFIG;

NET_DVR_API BOOL CALLBACK NET_ECMS_GetDevConfig(LONG lUserID, DWORD dwCommand, LPNET_EHOME_CONFIG lpConfig, DWORD dwConfigSize);

NET_DVR_API BOOL CALLBACK NET_ECMS_SetDevConfig(LONG lUserID, DWORD dwCommand, LPNET_EHOME_CONFIG lpConfig, DWORD dwConfigSize);

NET_DVR_API BOOL CALLBACK NET_ECMS_XMLConfig(LONG lUserID, LPNET_EHOME_XML_CFG pXmlCfg, DWORD dwConfigSize);

NET_DVR_API BOOL CALLBACK NET_ECMS_RemoteControl(LONG lUserID, DWORD dwCommand, LPNET_EHOME_REMOTE_CTRL_PARAM lpCtrlParam);

NET_DVR_API BOOL CALLBACK NET_ECMS_ISAPI_Config(LONG lUserID, NET_CMS_ISAPI_CONFIG *lpParam);

NET_DVR_API BOOL CALLBACK NET_ECMS_CheckStreamEncrypt(LONG lUserID, const char* pStreamEncrypt);

NET_DVR_API BOOL  CALLBACK NET_ECMS_SetDeviceSessionKey(NET_EHOME_DEV_SESSIONKEY* pDeviceKey);

NET_DVR_API BOOL  CALLBACK NET_ECMS_GetDeviceSessionKey(NET_EHOME_DEV_SESSIONKEY* pDeviceKey);


//preview request
typedef struct tagNET_EHOME_PREVIEWINFO_IN
{
    int iChannel;                        //channel no.
    DWORD dwStreamType;                    // Stream Type: 0- Main Stream, 1- Sub Stream, 2- Third Stream 
    DWORD dwLinkMode;                        // Link Mode: 0- TCP Mode, 1- UDP Mode 2-HRUDP Mode 
    NET_EHOME_IPADDRESS struStreamSever;     //Stream Media Server Address (IP address and port) 
}NET_EHOME_PREVIEWINFO_IN, *LPNET_EHOME_PREVIEWINFO_IN;

typedef struct tagNET_EHOME_PREVIEWINFO_IN_V11
{
    int iChannel;
    DWORD dwStreamType;
    DWORD dwLinkMode;
    NET_EHOME_IPADDRESS struStreamSever;
    BYTE  byDelayPreview;
    BYTE  byEncrypt; 
    BYTE  byRes[30];
}NET_EHOME_PREVIEWINFO_IN_V11, *LPNET_EHOME_PREVIEWINFO_IN_V11;

typedef struct tagNET_EHOME_MAKE_I_FRAME
{
    int iChannel;                      // channel
    DWORD dwStreamType;                  // stream type,0- main,1- sub, 2- reserve 
    BYTE  byRes[40];
}NET_EHOME_MAKE_I_FRAME, *LPNET_EHOME_MAKE_I_FRAME;

#define STREAM_KEY_LEN 32
typedef struct tagNET_EHOME_STREAM_PASSWORD
{
    BYTE byEnable;                  // encrypt operation,0-disable,1- able, 2-change password
    BYTE byRes1[3];
    BYTE byNewKey[STREAM_KEY_LEN];                  // password
    BYTE byOldKey[STREAM_KEY_LEN];      //old password
    BYTE  byRes[12];
}NET_EHOME_STREAM_PASSWORD, *LPNET_EHOME_STREAM_PASSWORD;


typedef struct tagNET_EHOME_PREVIEWINFO_OUT
{
    LONG  lSessionID; 
    BYTE byRes[128];
}NET_EHOME_PREVIEWINFO_OUT, *LPNET_EHOME_PREVIEWINFO_OUT;

typedef struct tagNET_EHOME_PUSHSTREAM_IN
{
    DWORD dwSize;
    LONG lSessionID; 
    BYTE  byRes[128];
}NET_EHOME_PUSHSTREAM_IN, *LPNET_EHOME_PUSHSTREAM_IN;

typedef struct tagNET_EHOME_PUSHSTREAM_INFO_OUT
{
    DWORD dwSize;
    BYTE  byRes[128];
}NET_EHOME_PUSHSTREAM_OUT, *LPNET_EHOME_PUSHSTREAM_OUT;

NET_DVR_API BOOL CALLBACK NET_ECMS_StartGetRealStream(LONG lUserID, LPNET_EHOME_PREVIEWINFO_IN pPreviewInfoIn, LPNET_EHOME_PREVIEWINFO_OUT pPreviewInfoOut );
NET_DVR_API BOOL CALLBACK NET_ECMS_StartGetRealStreamV11(LONG lUserID, LPNET_EHOME_PREVIEWINFO_IN_V11 pPreviewInfoIn, LPNET_EHOME_PREVIEWINFO_OUT pPreviewInfoOut);
NET_DVR_API BOOL CALLBACK NET_ECMS_StopGetRealStream(LONG lUserID, LONG lSessionID);
NET_DVR_API BOOL CALLBACK NET_ECMS_StartPushRealStream(LONG lUserID, LPNET_EHOME_PUSHSTREAM_IN pPushInfoIn, LPNET_EHOME_PUSHSTREAM_OUT pPushInfoOut);
NET_DVR_API BOOL CALLBACK NET_ECMS_MakeIFrame(LONG lUserID, LPNET_EHOME_MAKE_I_FRAME pIFrameParma);
NET_DVR_API BOOL CALLBACK NET_ECMS_SetStreamEncrypt(LONG lUserID, LPNET_EHOME_STREAM_PASSWORD pStreamPassword);
//search
#define MAX_FILE_NAME_LEN  100
#define LEN_32             32

typedef enum tagSEARCH_TYPE
{
    ENUM_SEARCH_TYPE_ERR = -1,
    ENUM_SEARCH_RECORD_FILE = 0,
    ENUM_SEARCH_PICTURE_FILE  = 1,
    ENUM_SEARCH_FLOW_INFO = 2,
    ENUM_SEARCH_DEV_LOG = 3,
    ENUM_SEARCH_ALARM_HOST_LOG = 4,
}SEARCH_TYPE_ENUM;

typedef enum
{
    ENUM_GET_NEXT_STATUS_SUCCESS = 1000,    // Get the file information successfully, call FindNext to get the next data.
    ENUM_GET_NETX_STATUS_NO_FILE,           // No file found
    ENUM_GET_NETX_STATUS_NEED_WAIT,         // Searching, please wait.
    ENUM_GET_NEXT_STATUS_FINISH,            // No more file found, search is finished
    ENUM_GET_NEXT_STATUS_FAILED,            // Exception when searching file
    ENUM_GET_NEXT_STATUS_NOT_SUPPORT        // This operation is not supported, no image query protocol for current device. 
}SEARCH_GET_NEXT_STATUS_ENUM;

typedef struct tagNET_EHOME_TIME
{
    WORD   wYear;        
    BYTE   byMonth;   
    BYTE   byDay;        
    BYTE   byHour;        
    BYTE   byMinute;
    BYTE   bySecond;    
    BYTE   byRes1;    
    WORD   wMSecond; 
    BYTE   byRes2[2];
}NET_EHOME_TIME, *LPNET_EHOME_TIME;

typedef struct  tagNET_EHOME_FINDCOND
{
    DWORD               dwSize;
    LONG                iChannel;           //Channel No, starting from 1 
    DWORD               dwMaxFileCountPer;  //Max File Number per Searching, depending on real network condition and 8 recommended 
    NET_EHOME_TIME      struStartTime;      //Start Time
    NET_EHOME_TIME      struStopTime;       //End time
    SEARCH_TYPE_ENUM    enumSearchType;     //Search Type
    union
    {
        BYTE            byLen[64];
        struct
        {
            DWORD       dwFileType;         /**Record File Type: 
                                            0xff- All Types (picture excluded)
                                            0- Scheduled Recording
                                            1- Motion
                                            2- Alarm
                                            3- Alarm | Motion 
                                            4- Alarm & Motion
                                            5- Command
                                            6- Manual Recording
                                            7- Vibrating Alarm
                                            8- Environment Alarm
                                            9- VCA Alarm (or Evidence Obtaining Recording)
                                            10(0x0a)- PIR Alarm
                                            11(0x0b)- Wireless Alarm
                                            12(0x0c)- Emergency Alarm
                                            13(0x0d)- All Alarms
                                            100- All Type Picture
                                            101- License Plate picture
                                            102- Auditing Alarm Picture
                                            103- Manual Shot Picture
                                            104- Playback Picture
                                            **/

        }struRecordFileParam;
        struct
        {
            DWORD       dwFileType;         /*Picture File Type: 255(0xff)- All Types
                                            0(0x00)- Scheduled Capture
                                            1(0x01)- Motion Capture
                                            2(0x02)- Alarm Capture 
                                            3(0x03)- Alarm | Motion Capture
                                            4(0x04)- Alarm & Motion Capture
                                            5(0x05)- Command Capture
                                            6(0x06)- Manual Capture
                                            7(0x07)- Vibrating Alarm Capture
                                            8(0x08)- Environment Alarm Capture
                                            9(0x09)- VCA Alarm Picture
                                            10(0x0a)- PIR Alarm Picture 
                                            11(0x0b)- Wireless Alarm Picture
                                            12(0x0c)- Emergency Alarm Picture
                                            13(0x0d)- Face Detection Picture
                                            14(0x0e)- Line Crossing Detection Picture 
                                            15(0x0f)- Intrusion Detection Picture
                                            16(0x10)- Scene Change Detection Picture
                                            17(0x11)- Local Playback Capture
                                            18(0x12)- VCA Detection Picture
                                            19(0x13)- Region Entrance Detection Picture
                                            20(0x14)- Region Exiting Detection Picture
                                            21(0x15)- Loitering Detection
                                            22(0x16)- People Gathering Detection Picture
                                            23(0x17)- Fast Moving Detection Picture
                                            24(0x18)- Parking Detection Picture
                                            25(0x19)- Unattended Baggage Detection Picture
                                            26(0x1a)- Object Removal Detection Picture
                                            27(0x1b)- License Detection Picture
                                            28(0x1c)- Picture Uploaded to Client 
                                            */
        }struPicFileParam;
        struct
        {
            BYTE        bySearchMode;       //search mode ，0-invalid，1-search by year、2-search by month, 3-search by day
        }struFlowParam;
    }unionSearchParam;
    char    byRes[128];
}NET_EHOME_FINDCOND, *LPNET_EHOME_FINDCOND;

typedef struct tagNET_EHOME_REC_FILE_COND
{
    DWORD           dwChannel;
    DWORD           dwRecType;
    NET_EHOME_TIME  struStartTime;
    NET_EHOME_TIME  struStopTime;
    DWORD           dwStartIndex;
    DWORD           dwMaxFileCountPer;
    BYTE            byLocalOrUTC;        
    BYTE            byRes[63];
}NET_EHOME_REC_FILE_COND, *LPNET_EHOME_REC_FILE_COND;

typedef struct tagNET_EHOME_PIC_FILE_COND
{
    DWORD           dwChannel;                 
    DWORD           dwPicType;                  
    NET_EHOME_TIME  struStartTime;    
    NET_EHOME_TIME  struStopTime;    
    DWORD           dwStartIndex;      
    DWORD           dwMaxFileCountPer; 
    BYTE            byLocalOrUTC;       
    BYTE            byRes[63];
}NET_EHOME_PIC_FILE_COND, *LPNET_EHOME_PIC_FILE_COND;

typedef struct tagNET_EHOME_FLOW_COND
{
    BYTE            bySearchMode;
    BYTE            byRes[3];
    NET_EHOME_TIME  struStartTime;    
    NET_EHOME_TIME  struStopTime;      
    DWORD           dwStartIndex;      
    DWORD           dwMaxFileCountPer;  
    BYTE            byLocalOrUTC;        
    BYTE            byRes1[63];
}NET_EHOME_FLOW_COND, *LPNET_EHOME_FLOW_COND;

typedef struct tagNET_EHOME_DEV_LOG_COND
{
    DWORD           dwMajorType;     
    DWORD           dwMinorType;     
    NET_EHOME_TIME  struStartTime;   
    NET_EHOME_TIME  struStopTime;     
    DWORD           dwStartIndex;      
    DWORD           dwMaxFileCountPer; 
    BYTE            byRes[64];
}NET_EHOME_DEV_LOG_COND, *LPNET_EHOME_DEV_LOG_COND;

typedef struct tagNET_EHOME_ALARM_HOST_LOG_COND
{
    DWORD           dwMajorType;      
    DWORD           dwMinorType;      
    NET_EHOME_TIME  struStartTime;    
    NET_EHOME_TIME  struStopTime;      
    DWORD           dwStartIndex;     
    DWORD           dwMaxFileCountPer; 
    BYTE            byRes1[64];
}NET_EHOME_ALARM_HOST_LOG_COND, *LPNET_EHOME_ALARM_HOST_LOG_COND;

typedef struct tagNET_EHOME_FINDDATA
{
    DWORD           dwSize;
    char            szFileName[MAX_FILE_NAME_LEN];  /**File Name */
    NET_EHOME_TIME  struStartTime;                  /**Start Time */
    NET_EHOME_TIME  struStopTime;                   /**End Time */
    DWORD           dwFileSize;                     /**File Size */
    DWORD           dwFileMainType;                 /**File Main Type. For detailed definition, please refer to dwFileType in NET_EHOME_FINDCOND. */
    DWORD           dwFileSubType;                  /**File Sub Type */
    DWORD           dwFileIndex;                    /**Record File Index */
    BYTE            byRes[128];
}NET_EHOME_FINDDATA, *LPNET_EHOME_FINDDATA;

typedef struct tagNET_EHOME_REC_FILE
{
    DWORD           dwSize;
    char            sFileName[MAX_FILE_NAME_LEN];   
    NET_EHOME_TIME  struStartTime;                 
    NET_EHOME_TIME  struStopTime;                  
    DWORD           dwFileSize;                   
    DWORD           dwFileMainType;               
    DWORD           dwFileSubType;                 
    DWORD           dwFileIndex;                   
    BYTE            byTimeDiffH;                  
    BYTE            byTimeDiffM;                 
    BYTE            byRes[126];
}NET_EHOME_REC_FILE, *LPNET_EHOME_REC_FILE;

typedef struct tagNET_EHOME_PIC_FILE
{
    DWORD           dwSize;
    char            sFileName[MAX_FILE_NAME_LEN];
    NET_EHOME_TIME  struPicTime;
    DWORD           dwFileSize;
    DWORD           dwFileMainType;
    DWORD           dwFileIndex;
    BYTE            byTimeDiffH;                 
    BYTE            byTimeDiffM;                    
    BYTE            byRes[126];
}NET_EHOME_PIC_FILE, *LPNET_EHOME_PIC_FILE;

typedef struct tagNET_EHOME_FLOW_INFO
{
    DWORD   dwSize;
    DWORD   dwFlowValue;
    DWORD   dwFlowIndex;
    BYTE    byRes[128];
}NET_EHOME_FLOW_INFO, *LPNET_EHOME_FLOW_INFO;

#define MAX_LOG_INFO_LEN    8*1024
typedef struct tagNET_EHOME_DEV_LOG
{
    NET_EHOME_TIME  struLogTime;             
    DWORD           dwMajorType;               
    DWORD           dwMinorType;               
    DWORD           dwParamType;               
    char            sLocalUser[NAME_LEN];    
    char            sRemoteUser[NAME_LEN];    
    char            sIPAddress[128];          
    DWORD           dwChannelNo;              
    DWORD           dwHardDiskNo;              
    DWORD           dwAlarmInputChanNo;        
    DWORD           dwAlarmOutputChanNo;       
    char            sLogContext[MAX_LOG_INFO_LEN];  
    BYTE            byTimeDiffH;                   
    BYTE            byTimeDiffM;                  
    BYTE            byRes[62];
}NET_EHOME_DEV_LOG, *LPNET_EHOME_DEV_LOG;

typedef struct tagNET_EHOME_ALARM_HOST_LOG
{
    NET_EHOME_TIME  struLogTime;               
    DWORD           dwMajorType;               
    DWORD           dwMinorType;              
    DWORD           dwParamType;               
    char            sUserName[NAME_LEN];       
    char            sIPAddress[128];            
    char            sLogContext[MAX_LOG_INFO_LEN];
    BYTE            byTimeDiffH;                   
    BYTE            byTimeDiffM;             
    BYTE            byRes[62];
}NET_EHOME_ALARM_HOST_LOG, *LPNET_EHOME_ALARM_HOST_LOG;

NET_DVR_API LONG CALLBACK NET_ECMS_StartFindFile(LONG lUserID, LPNET_EHOME_FINDCOND pFindCond);
NET_DVR_API LONG CALLBACK NET_ECMS_FindNextFile(LONG lHandle, LPNET_EHOME_FINDDATA pFindData); 

NET_DVR_API LONG CALLBACK NET_ECMS_StartFindFile_V11(LONG lUserID, LONG lSearchType, LPVOID pFindCond, DWORD dwCondSize);
NET_DVR_API LONG CALLBACK NET_ECMS_FindNextFile_V11(LONG lHandle, LPVOID pFindData, DWORD dwDataSize);
NET_DVR_API BOOL CALLBACK NET_ECMS_StopFindFile(LONG lHandle);

typedef struct tagNET_EHOME_PLAYBACK_INFO_IN
{
    DWORD       dwSize;
    DWORD       dwChannel;                    //Playback channel No.
    BYTE        byPlayBackMode;               //Playback mode,0- by file name, 1- by time 
    BYTE        byStreamPackage;              //stream package 0－PS（default） 1－RTP
    BYTE        byRes[2];
    union
    {
        BYTE    byLen[512];
        struct
        {
            char   szFileName[MAX_FILE_NAME_LEN];            /* Playback file name */
            DWORD  dwSeekType;                             
            DWORD  dwFileOffset;                           
            DWORD  dwFileSpan;                             
        }struPlayBackbyName;
        struct 
        {
            NET_EHOME_TIME  struStartTime;            /* Start time */
            NET_EHOME_TIME  struStopTime;            /* End time*/
            BYTE    byLocalOrUTC;                    
            BYTE    byDuplicateSegment;                
        }struPlayBackbyTime;
    }unionPlayBackMode;
    NET_EHOME_IPADDRESS struStreamSever;     //Stream media server address 
}NET_EHOME_PLAYBACK_INFO_IN, *LPNET_EHOME_PLAYBACK_INFO_IN;

typedef struct tagNET_EHOME_PLAYBACK_INFO_OUT
{
    LONG   lSessionID;     //SessionID, playback request session ID, not supported by protocol, returned -1 
    BYTE   byRes[128];
}NET_EHOME_PLAYBACK_INFO_OUT, *LPNET_EHOME_PLAYBACK_INFO_OUT;

typedef struct tagNET_EHOME_PUSHPLAYBACK_IN
{
    DWORD dwSize;
    LONG lSessionID; 
    BYTE byKeyMD5[32];
    BYTE  byRes[96];
} NET_EHOME_PUSHPLAYBACK_IN, *LPNET_EHOME_PUSHPLAYBACK_IN;

typedef struct tagNET_EHOME_PUSHPLAYBACK_OUT
{
    DWORD dwSize;
    BYTE  byRes[128];
} NET_EHOME_PUSHPLAYBACK_OUT, *LPNET_EHOME_PUSHPLAYBACK_OUT;

NET_DVR_API BOOL CALLBACK NET_ECMS_StartPlayBack(LONG lUserID, LPNET_EHOME_PLAYBACK_INFO_IN pPlayBackInfoIn, LPNET_EHOME_PLAYBACK_INFO_OUT pPlayBackInfoOut);
NET_DVR_API BOOL CALLBACK NET_ECMS_StopPlayBack(LONG lUserID, LONG lSessionID);
NET_DVR_API BOOL CALLBACK NET_ECMS_StartPushPlayBack(LONG lUserID, LPNET_EHOME_PUSHPLAYBACK_IN pPushInfoIn, LPNET_EHOME_PUSHPLAYBACK_OUT pPushInfoOut);

#define NET_EHOME_PTZ_CTRL                1000        
#define NET_EHOME_PRESET_CTRL        1001        
#define NET_EHOME_PZIN                        1002        
#define NET_EHOME_PTRACK                    1003    

typedef enum
{
    PTZ_UP = 0,            //up
    PTZ_DOWN,            //domn
    PTZ_LEFT,                //left
    PTZ_RIGHT,            //right 
    PTZ_UPLEFT,            //Upper-left
    PTZ_DOWNLEFT,        //Lower-left
    PTZ_UPRIGHT,            //Upper-right
    PTZ_DOWNRIGHT,        //Lower-right
    PTZ_ZOOMIN,            //Zoom－
    PTZ_ZOOMOUT,        //Zoom＋
    PTZ_FOCUSNEAR,        //Focus－
    PTZ_FOCUSFAR,        //Focus＋
    PTZ_IRISSTARTUP,        //Iris+
    PTZ_IRISSTOPDOWN,    //Iris-
    PTZ_LIGHT,            //light-compensating lamp
    PTZ_WIPER,            //Wiper
    PTZ_AUTO            //Auto
}EN_PTZ_CMD;

typedef struct tagNET_EHOME_PTZ_PARAM
{
    DWORD dwSize;
    BYTE  byPTZCmd;        
    BYTE  byAction;        //PTZ action, 0-start, 1- End 
    BYTE  bySpeed;        //PTZ speed, value range[0~7],the higher the level, the higher the speed. 
    BYTE  byRes[29];
}NET_EHOME_PTZ_PARAM, *LPNET_EHOME_PTZ_PARAM;

typedef struct tagNET_EHOME_PRESET_PARAM
{
    DWORD dwSize;
    BYTE  byPresetCmd;    //Preset control command, 1- Set the preset, 2- Clear preset, 3- Call the preset 
    BYTE  byRes1[3];
    DWORD dwPresetIndex;    //Preset No. 
    BYTE  byRes2[32];
}NET_EHOME_PRESET_PARAM, *LPNET_EHOME_PRESET_PARAM;

typedef struct tagNET_EHOME_PZIN_PARAM
{
    DWORD dwSize;
    BYTE  byAction;    //Action: 0- Zoom out(upper-right-> lower-left, lower-right-> upper left), 1- Zoom in (upper left->lower-right, lower-left->upper-right) 
    BYTE  byRes1[3];
    NET_EHOME_ZONE struArea;    //Selected area 
    BYTE  byRes2[32];
}NET_EHOME_PZIN_PARAM, *LPNET_EHOME_PZIN_PARAM;

typedef struct tagNET_EHOME_POINT
{
    DWORD dwX;
    DWORD dwY;
    BYTE  byRes[4];
}NET_EHOME_POINT, *LPNET_EHOME_POINT;

typedef struct tagNET_EHOME_IPADDR
{
    char         sIpV4[16];
    char        sIpV6[128];    
}NET_EHOME_IPADDR, *LPNET_EHOME_IPADDR;

#define MACADDR_LEN                    6       //mac length

typedef struct tagNET_EHOME_ETHERNET
{
    NET_EHOME_IPADDR    struDevIP;        //device IP address
    NET_EHOME_IPADDR    struDevIPMask;    //Device IP mask 
    DWORD        dwNetInterface; // Network card type, 1- 10M half-duplex,2- 10M full- duplex, 3- 100M half-duplex, 4- 100M full duplex, 6- 1000M full duplex,5- 10M/100M/1000M self-adapted. 
    WORD        wDevPort;                    //Device SDK port No., default:8000 
    WORD        wMTU;                        // MTU parameters 
    BYTE        byMACAddr[MACADDR_LEN]; //mac address
    BYTE        byRes[2];
}NET_EHOME_ETHERNET,*LPNET_EHOME_ETHERNET;
#define PASSWD_LEN                    16      //password length
typedef struct tagNET_EHOME_PPPOECFG
{
    DWORD        dwPPPoE;    //Enable PPPOE? 1- Enable, 0- Disable 
    char            sPPPoEUser[NAME_LEN];    //PPPoE user name
    char            sPPPoEPassword[PASSWD_LEN];    //PPPoE password
    NET_EHOME_IPADDR    struPPPoEIP;        //PPPoE IP address
}NET_EHOME_PPPOECFG,*LPNET_EHOME_PPPOECFG;

typedef struct tagNET_EHOME_NETWORK_CFG
{
    DWORD        dwSize;                
    NET_EHOME_ETHERNET    struEtherNet;    //Ethernet port 
    NET_EHOME_IPADDR        struGateWayIP;//Gateway address 
    NET_EHOME_IPADDR        struMultiCastIP;//Multi-cast address 
    NET_EHOME_IPADDR        struDDNSServer1IP;//DDNS1 server IP address 
    NET_EHOME_IPADDR        struDDNSServer2IP;//DDNS2 server IP address 
    NET_EHOME_IPADDR        struAlarmHostIP;    //Security control panel IP address 
    WORD        wAlarmHostPort;    //Security control panel port No.
    WORD        wIPResolverPort;    //Analysis server port No. 
    NET_EHOME_IPADDR        struIPResolver; //Analysis server IP address 
    NET_EHOME_PPPOECFG    struPPPoE;    //PPPoE
    WORD        wHTTPPort;;        //Http port
    BYTE        byRes[674];        
}NET_EHOME_NETWORK_CFG,*LPNET_EHOME_NETWORK_CFG;

typedef struct tagNET_EHOME_COMPRESSION_COND
{
    DWORD        dwSize;    
    DWORD        dwChannelNum;    //Channel No., start from 1. 
    BYTE        byCompressionType;//Stream type, 1- Main stream, 2- Sub stream, 3-third stream 
    BYTE        byRes[23];
}NET_EHOME_COMPRESSION_COND,*LPNET_EHOME_COMPRESSION_COND;

typedef struct tagNET_EHOME_COMPRESSION_CFG
{
    DWORD        dwSize;
    BYTE        byStreamType;    //Stream type: 0- video stream, 1- video & audio stream 
    BYTE        byPicQuality;    //Image quality, 0- highest, 1- higher, 2-media, 3- low, 4- lower, 5- lowest 
    BYTE        byBitRateType;    //Bit rate type, 0- Variable bit rate, 1- Constant bit rate 
    BYTE        byRes1;    
    DWORD        dwResolution;    //Resolution，0:DCIF 1:CIF 2:QCIF 3:4CIF 4:2CIF 6:QVGA（320x240） 16:VGA 17:UXGA 18:SVGA 19:HD720p 20:hd900 21:XVGA    22:SXGAp(1360*1024)
    //27:1080P(1920*1080)    28:2560x1920 /*500W*/    29:1600x304    30:2048x1536 /*300W*/
    //31:2448x2048/*500W*/        32:2448x1200        33:2448x800    34:XGA/*(1024*768)*/
    //35:SXGA/*(1280*1024)*/    36:WD1/*(960*576/960*480)*/    37:HD1080I    38-WXGA(1440*900)，
    //39-HD_F(1920*1080/1280*720)，40-HD_H(1920*540/1280*360)，  41-HD_Q(960*540/630*360)，  
    //42-2336*1744，    43-1920*1456，44-2592*2048，    45-3296*2472，46-1376*768，47-1366*768,                 
    //48-1360*768,  49-WSXGA+，50-720*720，51-1280*1280，52-2048*768，53-2048*2048
    //54-2560x2048,  55-3072x2048 ,  56-2304*1296  57-WXGA(1280*800),  58-1600*600    
    //59-2592*1944  60-2752*2208,    61-384*288,    62-4000*3000,  63-4096*2160,  64-3840*2160,
    //65-4000*2250, 66-3072*1728,
    DWORD        dwVideoBitRate;    //0-32K 1-48k 2-64K 3-80K 4-96K 5-128K 6-160k 7-192K 8-224K 9-256K 10-320K 11-384K 12-448K 13-512K 14-640K 15-768K 16-896K 17-1024K 18-1280K 19-1536K 20-1792K 21-2048K 22-self define
    DWORD        dwMaxBitRate;    //Custom bit rate, valid when dwVideoBitRate is 22 
    DWORD        dwVideoFrameRate;    //Video frame rate, 0- full，1- 1/16，2- 1/8，3- 1/4，4- 1/2，5- 1，6- 2，7- 4，8- 6，9- 8，10- 10，11- 12，12- 16，13- 20，14- 15，15- 18，16- 22 
    WORD        wIntervalFrameI;    //I frame interval, range[1~400] 
    BYTE        byIntervalBPFrame; //Frame type, 0- BBP，1- BP，2- P 
    BYTE        byRes[41];
}NET_EHOME_COMPRESSION_CFG,*LPNET_EHOME_COMPRESSION_CFG;

#define    MAX_TIME_SEGMENT          8 
#define MAX_ANALOG_ALARMOUT     32 
#define MAX_ANALOG_CHANNUM      32 
#define MAX_DIGIT_CHANNUM          480

typedef struct tagNET_EHOME_ALARM_TIME_COND
{
    DWORD        dwSize;    
    BYTE        byAlarmType;    //Alarm type, 0- motion detection, 1-video loss, 2-tampering alarm, 3-alarm input, 4-alarm output, 9- passenger flow volume 
    BYTE        byWeekday;    //0-Mon，1-Tues，2-Wed，3-Thur，4-Fri，5-Sat，6-Sun
    BYTE        byRes1[2];
    DWORD        dwChannel;    //Channel No., start from 1. 
    BYTE        byRes2[20];
}NET_EHOME_ALARM_TIME_COND,*LPNET_EHOME_ALARM_TIME_COND;

typedef struct tagNET_EHOME_SCHEDTIME
{
    BYTE        byStartHour;
    BYTE        byStartMin;
    BYTE        byStopHour;
    BYTE        byStopMin;
}NET_EHOME_SCHEDTIME,*LPNET_EHOME_SCHEDTIME;

typedef struct tagNET_EHOME_ALARM_TIME_CFG
{
    DWORD        dwSize;
    NET_EHOME_SCHEDTIME    struSchedTime[MAX_TIME_SEGMENT];//Alarm time duration, max. 8 durations, only 4 durations are supported by EHOME. 
    BYTE        bySchedTimeCount;    //The number of duration (read only) 
    BYTE        byRes[43];
}NET_EHOME_ALARM_TIME_CFG,*LPNET_EHOME_ALARM_TIME_CFG;

typedef struct tagNET_EHOME_ALARMOUT_CFG
{
    DWORD        dwSize;    
    BYTE        sAlarmOutName[NAME_LEN];    //Alarm output name
    WORD        wAlarmOutDelay;    //Output Delay, 0- 5s，1- 10s，2- 30s，3- 1min ，4- 2min，5- 5min，6- 10min，7- max 
    BYTE        byRes[26];    
}NET_EHOME_ALARMOUT_CFG,*LPNET_EHOME_ALARMOUT_CFG;

typedef struct tagNET_EHOME_ALARMOUT_STATUS_CFG
{
    DWORD        dwSize;
    BYTE        byAlarmOutStatus;    //Alarm output status, 1- Enable alarm output, 0- Disable alarm output 
    BYTE        byRes[11];
}NET_EHOME_ALARMOUT_STATUS_CFG,*LPNET_EHOME_ALARMOUT_STATUS_CFG;

typedef struct tagNET_EHOME_ALARMIN_COND
{
    DWORD        dwSize;    
    DWORD        dwAlarmInNum;    //Alarm No., start from 1. 
    DWORD        dwPTZChan;//PTZ linked video channel No., start from 1. 
    BYTE        byRes[20];
}NET_EHOME_ALARMIN_COND,*LPNET_EHOME_ALARMIN_COND;

typedef struct tagNET_EHOME_LINKAGE_ALARMOUT
{
    DWORD        dwAnalogAlarmOutNum;    //the number of analogy alarms(read only)
    BYTE        byAnalogAlarmOut[MAX_ANALOG_ALARMOUT];    //analogy alarm output, 0:disable, 1: enable
    BYTE        byRes[5000];
}NET_EHOME_LINKAGE_ALARMOUT,*LPNET_EHOME_LINKAGE_ALARMOUT;

typedef struct tagNET_EHOME_LINKAGE_PTZ
{
    BYTE    byUsePreset;    //Be using preset?0:not ；1:yes
    BYTE    byUseCurise;    //Be using curise?0:not,1:yes
    BYTE    byUseTrack;    //Be using track?0:not,1:yes
    BYTE    byRes1;    
    WORD    wPresetNo;    //preset NO.，rang:1~256
    WORD    wCuriseNo;    //curise NO., rang:1~16
    WORD    wTrackNo;    //track NO.,rang:1~16
    BYTE    byRes2[6];    
}NET_EHOME_LINKAGE_PTZ,*LPNET_EHOME_LINKAGE_PTZ;

typedef struct tagNET_EHOME_ALARMIN_LINKAGE_TYPE
{
    BYTE    byMonitorAlarm;    //Be using monitor alarm?0:not,1:yes
    BYTE    bySoundAlarm;    //Be using sound alarm?0:not,1:yes
    BYTE    byUpload;        //upload to center?0:not,1:yes
    BYTE    byAlarmout;        //alarm output?0:not,1:yes
    BYTE    byEmail;            //Be using email?0:not,1:yes
    BYTE    byRes1[3];        
    NET_EHOME_LINKAGE_PTZ    struPTZLinkage;    //PTZ releate
    NET_EHOME_LINKAGE_ALARMOUT    struAlarmOut;    //alarm out releate
    BYTE    byRes[128];
}NET_EHOME_ALARMIN_LINKAGE_TYPE,*LPNET_EHOME_ALARMIN_LINKAGE_TYPE;

typedef    struct    tagNET_EHOME_RECORD_CHAN
{
    BYTE    byAnalogChanNum;    //the number of analogy channel(read only)
    BYTE    byAnalogChan[MAX_ANALOG_CHANNUM];    //analogy channel，0:disable, 1:enable
    BYTE    byRes1[3];    
    WORD    wDigitChanNum;    //the number of IP channel(read only)
    BYTE    byDigitChan[MAX_DIGIT_CHANNUM];    //IP channel, 0:disable, 1:enable
    BYTE    byRes2[62];    
}NET_EHOME_RECORD_CHAN,*LPNET_EHOME_RECORD_CHAN;

typedef struct tagNET_EHOME_ALARMIN_CFG
{
    DWORD        dwSize;    
    BYTE        sAlarmInName[NAME_LEN];    //the name of alarm in
    BYTE        byAlarmInType;    //the type of alarmer：0:always open, 1:always close
    BYTE        byUseAlarmIn;    //Be using alarm in?0:not,1:yes
    BYTE        byRes1[2];        
    NET_EHOME_ALARMIN_LINKAGE_TYPE    struLinkageType;    //linage mod
    NET_EHOME_RECORD_CHAN    struRecordChan;    //linkage to record channel
    BYTE        byRes2[128];        
}NET_EHOME_ALARMIN_CFG,*LPNET_EHOME_ALARMIN_CFG;

typedef    struct    tagNET_EHOME_MANUAL_IOOUT_CTRL
{
    DWORD        dwSize;    
    DWORD        dwChan;        //IO output NO., start from 1
    DWORD        dwDelayTime;        //Alarm output duration(s), the value of 0 indicates continuous output 
    BYTE        byAction;        //Control type, 0- Disable alarm output, 1- Enable alarm output 
    BYTE        byRes[19];
}NET_EHOME_MANUAL_IOOUT_CTRL,*LPNET_EHOME_MANUAL_IOOUT_CTRL;

typedef struct tagNET_EHOME_IMAGE_CFG
{
    DWORD        dwSize;    
    BYTE        byHue;    //Hue, value range[0~255] 
    BYTE        byContrast;    //Contrast, value range[0~255] 
    BYTE        byBright;        //Brightness, value range[0~255] 
    BYTE        bySaturation;    //Saturation, value range[0~255] 
    BYTE        byRes[24];
}NET_EHOME_IMAGE_CFG,*LPNET_EHOME_IMAGE_CFG;

#define    NET_EHOME_GET_NETWORK_CFG        5    
#define    NET_EHOME_SET_NETWORK_CFG        6    
#define    NET_EHOME_GET_COMPRESSION_CFG    7    
#define    NET_EHOME_SET_COMPRESSION_CFG    8    
#define    NET_EHOME_GET_IMAGE_CFG            9    
#define    NET_EHOME_SET_IMAGE_CFG            10    
#define    NET_EHOME_GET_ALARMIN_CFG        11        
#define    NET_EHOME_SET_ALARMIN_CFG        12    
#define    NET_EHOME_GET_ALARM_TIME_CFG    13    
#define    NET_EHOME_SET_ALARM_TIME_CFG    14    
#define    NET_EHOME_GET_ALARMOUT_CFG        15    
#define    NET_EHOME_SET_ALARMOUT_CFG        16    
#define    NET_EHOME_GET_ALARMOUT_STATUS_CFG        17    
#define    NET_EHOME_SET_ALARMOUT_STATUS_CFG        18    
#define    NET_EHOME_MANUAL_IOOUT            19

typedef enum tagNET_CMS_ENUM_PROXY_TYPE
{
    ENUM_PROXY_TYPE_NETSDK = 0,
    ENUM_PROXY_TYPE_HTTP
}NET_CMS_ENUM_PROXY_TYPE;

typedef struct tagNET_EHOME_PT_PARAM
{
    NET_EHOME_IPADDRESS struIP;
    BYTE    byProtocolType;
    BYTE    byProxyType;
    BYTE    byRes[2];
}NET_EHOME_PT_PARAM, *LPNET_EHOME_Proxy_PARAM;

typedef struct tagNET_EHOME_PASSTHROUGH_PARAM
{
    DWORD    dwSequence;
    DWORD    dwUUID;
    BYTE            byRes[64];
}NET_EHOME_PASSTHROUGH_PARAM, *LPNET_EHOME_PASSTHROUGH_PARAM;

typedef struct tagNET_EHOME_PTXML_PARAM
{
    void*   pRequestUrl;        
    DWORD   dwRequestUrlLen;    
    void*   pCondBuffer;        
    DWORD   dwCondSize;         
    void*   pInBuffer;          
    DWORD   dwInSize;           
    void*   pOutBuffer;         
    DWORD   dwOutSize;          
    DWORD   dwReturnedXMLLen;   
    DWORD   dwRecvTimeOut;      //default 5000ms
    BYTE    byRes[28];          
}NET_EHOME_PTXML_PARAM, *LPNET_EHOME_PTXML_PARAM;

NET_DVR_API LONG CALLBACK NET_ECMS_StartListenProxy(LPNET_EHOME_Proxy_PARAM lpStru);
NET_DVR_API BOOL CALLBACK NET_ECMS_StopListenProxy(LONG lListenHandle, DWORD dwProxyType = 0);
NET_DVR_API LONG CALLBACK NET_ECMS_ConvertProtocolHttpToPassthrough(void* pSrcBuffer, DWORD dwSrcBufLen, void* pDestBuffer, DWORD dwDestBufLen, LPNET_EHOME_PASSTHROUGH_PARAM lpParam, BOOL bToPassthrough = TRUE);
typedef void (CALLBACK* PASSTHROUGHDATACALLBACK)(DWORD dwProxyType, LONG lListenHandle, void* pDeviceID, DWORD dwDevIDLen, void* pDataBuffer, DWORD dwDataLen, void* pUser);
NET_DVR_API BOOL CALLBACK NET_ECMS_SetPassthroughDataCallback(PASSTHROUGHDATACALLBACK fnPassthroughDataCb, void* pUser, DWORD dwProxyType = 0);
NET_DVR_API BOOL CALLBACK NET_ECMS_SendPassthroughData(void* pDataBuffer, DWORD dDataLen, DWORD dwProxyType = 0);
NET_DVR_API BOOL CALLBACK NET_ECMS_GetPTXMLConfig(LONG iUserID, LPNET_EHOME_PTXML_PARAM lpPTXMLParam);
NET_DVR_API BOOL CALLBACK NET_ECMS_PutPTXMLConfig(LONG iUserID, LPNET_EHOME_PTXML_PARAM lpPTXMLParam);
NET_DVR_API BOOL CALLBACK NET_ECMS_PostPTXMLConfig(LONG iUserID, LPNET_EHOME_PTXML_PARAM lpPTXMLParam);
NET_DVR_API BOOL CALLBACK NET_ECMS_DeletePTXMLConfig(LONG lUserID, LPNET_EHOME_PTXML_PARAM lpPTXMLParam);


NET_DVR_API BOOL CALLBACK NET_ECMS_SetSDKLocalCfg(NET_EHOME_LOCAL_CFG_TYPE enumType, void* const lpInBuff);
NET_DVR_API BOOL CALLBACK NET_ECMS_GetSDKLocalCfg(NET_EHOME_LOCAL_CFG_TYPE enumType,void *lpOutBuff);

typedef struct tagNET_EHOME_XML_REMOTE_CTRL_PARAM
{
    DWORD dwSize;
    void* lpInbuffer;          //input param buffer
    DWORD  dwInBufferSize;      //size of input param buffer
    DWORD  dwSendTimeOut;  //send time out,unit ms，default 5s
    DWORD  dwRecvTimeOut;  //receive time out,unit ms，default 5s
    void *lpOutBuffer;     //output buffer
    DWORD dwOutBufferSize;  //size of output buffer
    void *lpStatusBuffer;   //status buffer,if not user can set NULL
    DWORD dwStatusBufferSize;  //status buffer size
    BYTE   byRes[16];
}NET_EHOME_XML_REMOTE_CTRL_PARAM, *LPNET_EHOME_XML_REMOTE_CTRL_PARAM;
NET_DVR_API BOOL CALLBACK NET_ECMS_XMLRemoteControl(LONG lUserID, LPNET_EHOME_XML_REMOTE_CTRL_PARAM lpCtrlParam, DWORD dwCtrlSize);


#define    EHOME_CMSALARM_EXCEPTION      0x105  //CMS receive alarm exception
NET_DVR_API BOOL CALLBACK NET_ECMS_SetExceptionCallBack(DWORD dwMessage, HANDLE hWnd, void (CALLBACK* fExceptionCallBack)(DWORD dwType, LONG iUserID, LONG iHandle, void* pUser), void* pUser);

NET_DVR_API BOOL CALLBACK NET_ECMS_TranBuf(LONG lUserID, DWORD dwLength, void *pBuf);


typedef enum
{
    LONG_CFG_CREATED,  //create success
    LONG_CFG_CREATE_FAIL,   //create failed
    LONG_CFG_DATA,  //normal data
    LONG_CFG_TERMINATE  //destory
}LONG_LINK_MSG;

typedef BOOL(CALLBACK *LongConfigCallBack)(LONG iHandle, LONG_LINK_MSG enMsg, void *pOutBuffer, DWORD dwOutLen, void *pUser);

typedef struct tagNET_EHOME_LONG_CFG_INPUT
{
    LongConfigCallBack fnDataCallBack;
    void *pUser;
    BYTE byRes[32];
}NET_EHOME_LONG_CFG_INPUT, *LPNET_EHOME_LONG_CFG_INPUT;

typedef struct tagNET_EHOME_LONG_CFG_SEND
{
    void *pDataBuffer;
    DWORD dwDataLen;
    BYTE byRes[32];
}NET_EHOME_LONG_CFG_SEND, *LPNET_EHOME_LONG_CFG_SEND;

typedef struct
{
    UINT      dwEhomeCommonCmd;     /* 命令所在模块 */
    UINT      dwDataLen;            /* 长度 */
    BYTE       byRes[24];
}EHOMECMD_HEADER, *EHOMECMD_HEADER_PTR;/* 32bytes */

typedef struct
{
    UINT  dwLength;
    INT  iRetVal;
    BYTE  byRes[24];
}EHOMERET_HEADER, *EHOMERET_HEADER_PTR;/* 32bytes */

typedef struct
{
    EHOMERET_HEADER     struEhomeRetHead;
    char                szContent[8 * 1024];//返回的数据
}NET_EHOME_INFO_RECV, *LPNET_EHOME_INFO_RECV;

typedef struct
{
    void     *lpInBuffer;
    DWORD    dwInBufferSize;
}NET_EHOME_INFO_SEND, *LPNET_EHOME_INFO_SEND;

NET_DVR_API LONG CALLBACK NET_ECMS_SendWithRecInfoRelease(LONG lUserID, LONG dwCommand, NET_EHOME_INFO_SEND *pSendData,
    NET_EHOME_INFO_RECV *pRecvData, LONG dwTimeOut);

NET_DVR_API LONG CALLBACK NET_ECMS_SendWithOutRecInfoRelease(LONG lUserID, LONG dwCommand, NET_EHOME_INFO_SEND *pSendData,
     LONG dwTimeOut);

NET_DVR_API LONG CALLBACK NET_ECMS_LongConfigCreate(LONG lUserlD, LPNET_EHOME_LONG_CFG_INPUT pLongCfgInput);

NET_DVR_API BOOL CALLBACK NET_ECMS_LongConfigSend(LONG lHandle, LPNET_EHOME_LONG_CFG_SEND pSend);

NET_DVR_API BOOL CALLBACK NET_ECMS_LongConfigDestory(LONG lHandle);

NET_DVR_API BOOL CALLBACK NET_ECMS_LongConfigGetSessionId(LONG iHandle, LONG *pSessionId);

typedef struct tagNET_EHOME_ASYNC_RESP_CB_DATA
{
    void*  pOutBuffer;      //response data
    DWORD  dwOutLen;       //response data length
    DWORD  dwErrorNo;      //SDK  errorno
    DWORD  dwHandle;       //msg handle
    LONG  lUserID;
    char byRes[32];
}NET_EHOME_ASYNC_RESP_CB_DATA, *LPNET_EHOME_ASYNC_RESP_CB_DATA;
typedef BOOL(CALLBACK * ASYNC_RESPONSE_CB)(LPNET_EHOME_ASYNC_RESP_CB_DATA lpData, void *pUser);
NET_DVR_API BOOL CALLBACK NET_ECMS_SetXmlConfigResponseCB(ASYNC_RESPONSE_CB fnCB, void *pUser);

NET_DVR_API BOOL CALLBACK NET_ECMS_XMLConfigEx(LONG lUserID, NET_EHOME_XML_CFG * pXmlCfg, DWORD *dwHandle);

#endif //_HC_EHOME_CMS_H_
