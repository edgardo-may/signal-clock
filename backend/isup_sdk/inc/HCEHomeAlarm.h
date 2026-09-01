#ifndef _HC_EHOME_ALARM_H_
#define _HC_EHOME_ALARM_H_

#include "HCEHomePublic.h"

#define   EHOME_ALARM_UNKNOWN 0  //Unknown Alarm
#define   EHOME_ALARM                    1        //Ehome Basic Alarm
#define   EHOME_ALARM_HEATMAP_REPORT    2        //Heatmap Report Uploading
#define   EHOME_ALARM_FACESNAP_REPORT    3        //Face Capture Report Uploading
#define   EHOME_ALARM_GPS                4        //GPS Information Uploading
#define   EHOME_ALARM_CID_REPORT        5        //Security Control Panel CID Report Uploading
#define   EHOME_ALARM_NOTICE_PICURL    6        //Picture URL upload
#define    EHOME_ALARM_NOTIFY_FAIL        7        //Notify fail operation
#define   EHOME_ALARM_DEVICE_NETSWITCH_REPORT 10    //Switch net
#define   EHOME_ALARM_ACS              11       //ACS event
#define EHOME_ALARM_WIRELESS_INFO   12   //wireless infomation upload
#define EHOME_ISAPI_ALARM   13           //ISAPI alarm

#define MAX_TIME_LEN                32      //the lenght of time string
#define MAX_REMARK_LEN        64      //the length of alarm remark
#define MAX_URL_LEN                512     //the length of URL
#define CID_DES_LEN                    32      //the length of CID alarm describe
#define MAX_FILE_PATH_LEN  256

typedef enum
{
    ALARM_TYPE_DISK_FULL = 0,                     //0-HDD Full
    ALARM_TYPE_DISK_WRERROR,                     //1-HDD Reading/Writing Error
    ALARM_TYPE_VIDEO_LOST = 5,                   //5-Viseo Loss
    ALARM_TYPE_EXTERNAL,                         //6-External Alarm
    ALARM_TYPE_VIDEO_COVERED,                    //7-Tampering Alarm
    ALARM_TYPE_MOTION,                           //8-Motion Detection
    ALARM_TYPE_STANDARD_NOTMATCH,                //9-Format Unmatched
    ALARM_TYPE_SPEEDLIMIT_EXCEED,                //10-Over-speed
    ALARM_TYPE_PIR,                                 //11-PIR alarm
    ALARM_TYPE_WIRELESS,                         //12-Wireless Alarm
    ALARM_TYPE_CALL_HELP,                         //13-Emergency alarm
    ALARM_TYPE_DISARM,                             //14-Arming/disarming alarm
    ALARM_TYPE_STREAM_PRIVATE,                     //15-Stream privacy status changing notice
    ALARM_TYPE_PIC_UPLOAD_FAIL,                     //16-Failed to upload the image
    ALARM_TYPE_LOCAL_REC_EXCEPTION,                 //17-Local capture and record exception
    ALARM_TYPE_UPGRADE_FAIL,                     //18-Failed to upgrade device version.
    ALARM_TYPE_ILLEGAL_ACCESS,                     //19-Illegal accessing
    ALARM_TYPE_SOUNDLIMIT_EXCEED = 80,           //80-Decibel levels over limitation 
    ALARM_TYPE_TRIFFIC_VIOLATION = 90,             //90-Violation alarm
    ALARM_TYPE_ALARM_CONTROL,                     //91-Arming alarm
    ALARM_TYPE_FACE_DETECTION = 97,                 //97-Face recognition 
    ALARM_TYPE_DEFOUSE_DETECTION,                 //98-Defocus detection
    ALARM_TYPE_AUDIO_EXCEPTION,                     //99-Audio Exception
    ALARM_TYPE_SCENE_CHANGE,                     //100-Scene change
    ALARM_TYPE_TRAVERSE_PLANE,                     //101-Line crossing
    ALARM_TYPE_ENTER_AREA,                         //102-Region entrance
    ALARM_TYPE_LEAVE_AREA,                         //103-Region Exiting
    ALARM_TYPE_INTRUSION,                         //104-Intrusion
    ALARM_TYPE_LOITER,                             //105-Loitering 
    ALARM_TYPE_LEFT_TAKE,                         //106-Object leaving
    ALARM_TYPE_CAR_STOP,                         //107-Parking
    ALARM_TYPE_MOVE_FAST,                         //108-Fast moving
    ALARM_TYPE_HIGH_DENSITY,                     //109-People Gathering
    ALARM_TYPE_PDC_BY_TIME,                         //110-visitors flowrate by time
    ALARM_TYPE_PDC_BY_FRAME,                     //111-visitors flowrate by frame
    ALARM_TYPE_LEFT,                             //112-Unattended Baggage
    ALARM_TYPE_TAKE,                             //113-Object Removal
    ALARM_TYPE_ROLLOVER,                         //114-roll over
    ALARM_TYPE_COLLISION,                       //115-collision

    ALARM_TYPE_FLOW_OVERRUN = 256,                    //256-flow overrun alarm
    ALARM_TYPE_WARN_FLOW_OVERRUN,              //257-flow overrun warning


    ALARM_TYPE_DEV_CHANGED_STATUS = 700,          //700-device status change
    ALARM_TYPE_CHAN_CHANGED_STATUS,               //701-channel status change
    ALARM_TYPE_HD_CHANGED_STATUS,               //702-disk status change
    ALARM_TYPE_DEV_TIMING_STATUS,               //703-time upload device status
    ALARM_TYPE_CHAN_TIMING_STATUS,               //704-time upload channel status
    ALARM_TYPE_HD_TIMING_STATUS,               //705-time disk status info 
    ALARM_TYPE_RECORD_ABNORMAL,               //706-record exception

    ALARM_TYPE_ENV_LIMIT = 8800,                 //8800-Power supply monitoring value over limitation
    ALARM_TYPE_ENV_REAL_TIME,                     //8801-Power supply monitoring value ral-time data uploading
    ALARM_TYPE_ENV_EXCEPTION,                     //8802-Power supply monitoring system exception upload
    ALARM_TYPE_HIGH_TEMP = 40961,                 //40961-Device temperature over limitation
    ALARM_TYPE_ACC_EXCEPTION,                     //40962-Device accelerated speed exception
}EN_ALARM_TYPE;

/*dwAlarmType Macro Definition Value Action Time VideoChannel AlarmInChannel DiskNumber Remark 
ALARM_TYPE_DISK_FULL 0 HDD Full0-Start
1-End Alarm start or end time N/A N/A 1~MAX N/A 
ALARM_TYPE_DISK_WRERROR 1 HDD Reading/Writing Error N/A N/A 1~MAX N/A 
ALARM_TYPE_VIDEO_LOST 5 Viseo Loss 1~MAX N/A N/A N/A 
ALARM_TYPE_EXTERNAL 6 External Alarm N/A 1~MAX N/A N/A 
ALARM_TYPE_VIDEO_COVERED 7 Tampering Alarm 1~MAX N/A N/A N/A 
ALARM_TYPE_MOTION 8 Motion Detection 1~MAX N/A N/A N/A 
ALARM_TYPE_STANDARD_NOTMATCH 9 Format Unmatched N/A N/A N/A N/A 
ALARM_TYPE_SPEEDLIMIT_EXCEED 10 Over-speed Speed Limitation/td>  Current spped N/A N/A 
ALARM_TYPE_PIR 11 PIR alarm 1~MAX(PIR alarm No., default:1) N/A N/A N/A 
ALARM_TYPE_WIRELESS 12 Wireless Alarm N/A 1~MAX(Wireless alarm No.) N/A N/A 
ALARM_TYPE_CALL_HELP 13 Emergency alarm 1~MAX(alarm No., default:1) N/A N/A N/A 
ALARM_TYPE_DISARM 14 Arming/disarming alarm 0-Arm
1-Disarm Arming/Disarming time N/A N/A N/A N/A 
ALARM_TYPE_STREAM_PRIVATE 15 Stream privacy status changing notice֪ 0-Enable
1-Disable Enable/Disable time N/A N/A N/A N/A 
ALARM_TYPE_PIC_UPLOAD_FAIL 16 Failed to upload the image 0-Exception occurred or alarm Exception/alarm occurring time 1~MAX(camera No.) Alarm type Capture Serial No. N/A 
ALARM_TYPE_LOCAL_REC_EXCEPTION 17 Local capture and record exception N/A N/A N/A N/A 
ALARM_TYPE_UPGRADE_FAIL 18 Failed to upgrade device version. N/A N/A N/A Current version No., format:Vx.y.z buildYYMMDD 
ALARM_TYPE_ILLEGAL_ACCESS 19 Illegal accessing N/A N/A N/A N/A 
ALARM_TYPE_SOUNDLIMIT_EXCEED 80 Decibel levels over limitation  Decibel levels*10 Current decibel levels*10 N/A N/A 
ALARM_TYPE_TRIFFIC_VIOLATION 90 Violation alarm N/A N/A N/A N/A 
ALARM_TYPE_ALARM_CONTROL 91 Arming alarm N/A N/A N/A N/A 
ALARM_TYPE_FACE_DETECTION 97 Face recognition  0-alarm start
1- alarm end Alarm start/end time 1~MAX N/A N/A N/A 
ALARM_TYPE_DEFOUSE_DETECTION 98 Defocus detection 1~MAX N/A N/A N/A 
ALARM_TYPE_AUDIO_EXCEPTION 99 Audio Exception 1~MAX N/A N/A N/A 
ALARM_TYPE_SCENE_CHANGE 100 Scene change 1~MAX N/A N/A N/A 
ALARM_TYPE_TRAVERSE_PLANE 101 Line crossing 1~MAX N/A N/A N/A 
ALARM_TYPE_ENTER_AREA 102 Region entrance 1~MAX N/A N/A N/A 
ALARM_TYPE_LEAVE_AREA 103 Region Exiting 1~MAX N/A N/A N/A 
ALARM_TYPE_INTRUSION 104 Intrusion 1~MAX N/A N/A N/A 
ALARM_TYPE_LOITER 105 Loitering  1~MAX N/A N/A N/A 
ALARM_TYPE_LEFT_TAKE 106 Object leaving 1~MAX N/A N/A N/A 
ALARM_TYPE_CAR_STOP 107 Parking 1~MAX N/A N/A N/A 
ALARM_TYPE_MOVE_FAST 108 Fast moving 1~MAX N/A N/A N/A 
ALARM_TYPE_HIGH_DENSITY 109 People Gathering 1~MAX N/A N/A N/A 
ALARM_TYPE_LEFT 112 Unattended Baggage 1~MAX N/A N/A N/A 
ALARM_TYPE_TAKE 113 Object Removal 1~MAX N/A N/A N/A 
ALARM_TYPE_PDC_BY_TIME 110 Passenger flow volume time duration statistics uploading  0- Start  Statistic start time 1~MAX Entering number Exiting number Statistic end time: YYYY-MM-DD HHMISS 
ALARM_TYPE_PDC_BY_FRAME 111 Passenger flow volume single-frame statistic upload Statistic current frame time 1~MAX Entering number Exiting number   
ALARM_TYPE_ENV_LIMIT 8800 Power supply monitoring value over limitation Alarm occurring time Point No., default:104 N/A N/A Alarm/exception description information, no more than 256 bytes 
ALARM_TYPE_ENV_REAL_TIME 8801 Power supply monitoring value ral-time data uploading Upload time Point No. default: 104 N/A N/A Power supply monitoring value ral-time data, double type, such as 11.2011.20 
ALARM_TYPE_ENV_EXCEPTION 8802 Power supply monitoring system exception upload Exception occurring time N/A N/A N/A Alarm/ exception description information, no more than 256 bytes 
ALARM_TYPE_HIGH_TEMP 40961 Device temperature over limitation Alarm occurring time N/A N/A N/A N/A 
ALARM_TYPE_ACC_EXCEPTION 40962 Device accelerated speed exception Alarm occurring time N/A N/A N/A N/A 
*/

typedef struct tagNET_EHOME_DEV_STATUS_CHANGED
{
    BYTE   byDeviceStatus; //device status，0－normal；1－CPU high，more than 85%,2－hardware error
    BYTE   byRes[11];
}NET_EHOME_DEV_STATUS_CHANGED, *LPNET_EHOME_DEV_STATUS_CHANGED;



typedef struct tagNET_EHOME_CHAN_STATUS_CHANGED
{
    WORD  wChanNO;      //channel no
    BYTE   byChanStatus;     //channel status
    //bit0：enable status，0-disable/delete，1-enable/add
    //bit1：on line，0-off line，1-on line
    //bit2：signal ，0-dissignal，1-signal
    //bit3：record，0-disrecord 1-recording
    //bit4：IPchannel info change，0-dischange 1-change，
    BYTE   byRes[9];
}NET_EHOME_CHAN_STATUS_CHANGED, *LPNET_EHOME_CHAN_STATUS_CHANGED;


typedef struct tagNET_EHOME_HD_STATUS_CHANGED
{
    DWORD       dwVolume;       //volume，unite：MB
    WORD        wHDNo;      //No
    BYTE        byHDStatus;     //staus, 0-activity,1-sleep,2-exception,3-error
    //4-unformat, 5-not connect,6-formating
    BYTE        byRes[5];
}NET_EHOME_HD_STATUS_CHANGED, *LPNET_EHOME_HD_STATUS_CHANGED;


typedef struct tagNET_EHOME_DEV_TIMING_STATUS
{
    DWORD       dwMemoryTotal; //total memroy
    DWORD       dwMemoryUsage;     //usage，
    BYTE        byCPUUsage;         //CPU usage
    BYTE        byMainFrameTemp;    //frame temperature
    BYTE        byBackPanelTemp;      // panel temperature
    BYTE        byRes;
}NET_EHOME_DEV_TIMING_STATUS, *LPNET_EHOME_DEV_TIMING_STATUS;


typedef struct tagNET_EHOME_CHAN_TIMING_STATUS_SINGLE
{
    DWORD dwBitRate;       //bit rate
    WORD  wChanNO;    //channel no
    BYTE   byLinkNum;  //client link number
    BYTE   byRes[5];
}NET_EHOME_CHAN_TIMING_STATUS_SINGLE, *LPNET_EHOME_CHAN_TIMING_STATUS_SINGLE;


typedef struct tagNET_EHOME_HD_TIMING_STATUS_SINGLE
{
    DWORD   dwHDFreeSpace;    //free space
    WORD    wHDNo;  //no 
    BYTE    byRes[6];
}NET_EHOME_HD_TIMING_STATUS_SINGLE, *LPNET_EHOME_HD_TIMING_STATUS_SINGLE;

typedef union tagNET_EHOME_ALARM_STATUS_UNION
{
    BYTE    byRes[12]; //union size
    NET_EHOME_DEV_STATUS_CHANGED struDevStatusChanged;
    NET_EHOME_CHAN_STATUS_CHANGED struChanStatusChanged;
    NET_EHOME_HD_STATUS_CHANGED struHdStatusChanged;
    NET_EHOME_DEV_TIMING_STATUS struDevTimeStatus;
    NET_EHOME_CHAN_TIMING_STATUS_SINGLE struChanTimeStatus;
    NET_EHOME_HD_TIMING_STATUS_SINGLE struHdTimeStatus;
}NET_EHOME_ALARM_STATUS_UNION, *LPNET_EHOME_ALARM_STATUS_UNION;

typedef struct tagNET_EHOME_ALARM_INFO
{
    DWORD    dwSize;
    char    szAlarmTime[MAX_TIME_LEN];    //Alarm time, format:YYYY-MM-DD HH:MM:SS 
    char    szDeviceID[MAX_DEVICE_ID_LEN];//Device ID 
    DWORD    dwAlarmType;                  //Alarm type, for details, see the 'remark' session. 
    DWORD    dwAlarmAction;                //Alarm action, 0- Start, 1- End, for details, see the 'remark' session. 
    DWORD    dwVideoChannel;               //Video channel No., for details, see the 'remark' session. 
    DWORD    dwAlarmInChannel;             //Alarm input port, for details, see the 'remark' session. 
    DWORD    dwDiskNumber;                 //HDD No., for details, see the 'remark' session. 
    BYTE    byRemark[MAX_REMARK_LEN];      //Remark, for details, see the 'remark' session. 
    BYTE    byRetransFlag;                  //Retransmission flag, 0- Real-time package, 1- Retransmission package 
    BYTE  byRes1[3];
    char    szAlarmUploadTime[MAX_TIME_LEN];    //Alarm upload time,format:YYYY-MM-DD HH:MM:SS
    NET_EHOME_ALARM_STATUS_UNION    uStatusUnion;
}NET_EHOME_ALARM_INFO, *LPNET_EHOME_ALARM_INFO;

typedef struct tagNET_EHOME_GPS_INFO
{
    DWORD    dwSize;
    char    bySampleTime[MAX_TIME_LEN];      //GPS time sample , format:YYYY-MM-DD HH:MM:SS 
    char    byDeviceID[MAX_DEVICE_ID_LEN];   //Device registration ID 
    char    byDivision[2];                   //division[0]:'E'or'W'(east longitude/west longitude), division[1]:'N'or'S'(northern latitude/Southern latitude) 
    BYTE    bySatelites;                     //Number of satellites 
    BYTE    byPrecision;                     //Precision, default value *100
    DWORD    dwLongitude;                     //Longitude, value range(0~180*3600*100), conversion formula: longitude = actual degree*3600*100+actual minute*60*100+actual second*100 
    DWORD    dwLatitude;                      //Latitude,value range(0~90*3600*100), conversion formula: latitude = actual degree*3600*100+actual minute*60*100+actual second*100 
    DWORD    dwDirection;                     //Direction, value range(0~359.9*100), 0 for due north, conversion formula:direction= Actual direction*100
    DWORD    dwSpeed;                         //Speed, value range (0~999.9*100000), conversion formula:speed = actual speed*100000, cm/hour 
    DWORD    dwHeight;                         //Height, unit: cm 
    BYTE    byRetransFlag;                     //Retransmission flag: 0- real-time package, 1- retransmission package 
    BYTE    byLocateMode;                      //locate mode(0)，only NMEA0183 3.00 version has，value：0-self locate，1- diff，2- calculate，3- invalid 
    BYTE    byRes1[2];
    DWORD   dwMileage;                       //device mileage static，unite m
    BYTE    byRes[56];
}NET_EHOME_GPS_INFO, *LPNET_EHOME_GPS_INFO;

typedef struct tagNET_EHOME_ALARMWIRELESSINFO
{
    BYTE     byDeviceID[MAX_DEVICE_ID_LEN];   //device id
    DWORD     dwDataTraffic;    /*data traffic,unit:MB,actual*100*/
    BYTE      bySignalIntensity;  /* singnal intensity,0~100 */
    BYTE      byRes[127];
} NET_EHOME_ALARMWIRELESSINFO, *LPNET_EHOME_ALARMWIRELESSINFO;

typedef struct tagNET_EHOME_HEATMAP_VALUE
{
    DWORD dwMaxHeatMapValue;    //Max. value of the heat 
    DWORD dwMinHeatMapValue;    //Min. value of the heat 
    DWORD dwTimeHeatMapValue;    //The average value of the heat 
}NET_EHOME_HEATMAP_VALUE, *LPNET_EHOME_HEATMAP_VALUE;

typedef struct tagNET_EHOME_PIXEL_ARRAY_SIZE
{
    DWORD dwLineValue;    //The pixel value in line 
    DWORD dwColumnValue;//The pixel value in column 
}NET_EHOME_PIXEL_ARRAY_SIZE, *LPNET_EHOME_PIXEL_ARRAY_SIZE;

typedef struct tagNET_EHOME_HEATMAP_REPORT
{
    DWORD   dwSize;
    char    byDeviceID[MAX_DEVICE_ID_LEN];   //Device registration ID 
    DWORD   dwVideoChannel;                     //channel NO.
    char    byStartTime[MAX_TIME_LEN];       //Start time, format:YYYY-MM-DD HH:MM:SS 
    char    byStopTime[MAX_TIME_LEN];        //End time, format:YYYY-MM-DD HH:MM:SS 
    NET_EHOME_HEATMAP_VALUE struHeatmapValue;//Heat map parameters 
    NET_EHOME_PIXEL_ARRAY_SIZE struPixelArraySize;    //The size of the heat map 
    char    byPixelArrayData[MAX_URL_LEN];     //Heat map data index 
    BYTE    byRetransFlag;                     //Flag retransmission, 0- Real-time package,1- Retransmission package 
    BYTE    byRes[63];
}NET_EHOME_HEATMAP_REPORT, *LPNET_EHOME_HEATMAP_REPORT;


typedef struct tagNET_EHOME_HUMAN_FEATURE
{
    BYTE byAgeGroup;    //Age group: 1-Infant, 2-Child, 3-Junior, 4-Teenager, 5-Youth, 6-Prime, 7-Middle age, 8-Elderly, 9-Old age 
    BYTE bySex;            //Gender, 1- Male, 2- Female 
    BYTE byEyeGlass;    //With glasses? 1- No, 2- Yes
    BYTE byRes[13];
}NET_EHOME_HUMAN_FEATURE, *LPNET_EHOME_HUMAN_FEATURE;

typedef struct tagNET_EHOME_FACESNAP_REPORT
{
    DWORD   dwSize;
    char    byDeviceID[MAX_DEVICE_ID_LEN];   //Device registration ID 
    DWORD   dwVideoChannel;                     //Video channel No. 
    char    byAlarmTime[MAX_TIME_LEN];       //Alarm time, format: YYYY-MM-DD HH:MM:SS 
    DWORD   dwFacePicID;                     //Face picture ID 
    DWORD   dwFaceScore;                     //Face score, value range:0~100 
    DWORD   dwTargetID;                         //Target ID 
    NET_EHOME_ZONE    struTarketZone;             //Target area 
    NET_EHOME_ZONE  struFacePicZone;         //Face picture area 
    NET_EHOME_HUMAN_FEATURE struHumanFeature;//Human feature
    DWORD    dwStayDuration;                     //Time of remaining in the scene, unit: ms. 
    DWORD    dwFacePicLen;                     //The length of face picture, unit: byte 
    char    byFacePicUrl[MAX_URL_LEN];         //Face picture index 
    DWORD    dwBackgroudPicLen;                     //Background picture length, unit:byte 
    char    byBackgroudPicUrl[MAX_URL_LEN];         //Background picture index 
    BYTE    byRetransFlag;                     //Retransmission flag: 0- real-time package, 1- retransmission package 
    BYTE    byRes[63];
}NET_EHOME_FACESNAP_REPORT, *LPNET_EHOME_FACESNAP_REPORT;

typedef struct tagNET_EHOME_CID_PARAM
{
    DWORD dwUserType;    //User type, 1- Keypad user, 2- Network user, other value indicates void. 
    LONG  lUserNo;        //User type, -1 indicates invalid. 
    LONG  lZoneNo;        //Zone No. 
    LONG  lKeyboardNo;    //Keyboard No.
    LONG  lVideoChanNo;    //Video Channel No. 
    LONG  lDiskNo;        //Disk No. 
    LONG  lModuleAddr;    //Module address 
    char  byUserName[NAME_LEN];    //user name
    BYTE  byRes[32];
}NET_EHOME_CID_PARAM, *LPNET_EHOME_CID_PARAM;

typedef struct tagNET_EHOME_CID_INFO
{
    DWORD   dwSize;
    char        byDeviceID[MAX_DEVICE_ID_LEN];   //device ID
    DWORD   dwCIDCode;                         //CID code
    DWORD   dwCIDType;                      //CID alarm type
    DWORD   dwSubSysNo;                         //Number of subsystem generating reports, 0:global reports, the value of subsystem rang:0~32
    char    byCIDDescribe[CID_DES_LEN];         //the describe of CID alarm
    char        byTriggerTime[MAX_TIME_LEN];     //the CID Alarm time, format:YYYY-MM-DD HH:MM:SS
    char        byUploadTime[MAX_TIME_LEN];         //CID report upload time, format:YYYY-MM-DD HH:MM:SS
    NET_EHOME_CID_PARAM struCIDParam;         //the para of CID alarm    
    BYTE    byTimeDiffH;
    BYTE    byTimeDiffM;
    BYTE    byRecheck;
    BYTE    byRes[61];
    char  byUUID[MAX_UUID_LEN];
    char  byVideoURL[MAX_URL_LEN];
}NET_EHOME_CID_INFO, *LPNET_EHOME_CID_INFO;

typedef struct tagNET_EHOME_NOTICE_PICURL
{
    DWORD   dwSize;
    char    byDeviceID[MAX_DEVICE_ID_LEN];   //Device register ID
    WORD    wPicType;
    //Picture type, valid if fail command is capture picture fail, 0-PU capture picture by time, 1-PU capture picture by alarm, 2-CU manual capture picture, 
    //3-CU download picture, 4-event trigger PU capture picture
    WORD    wAlarmType; //Alarm type, 6-alarm in, 7-shelter, 8-motion detect, 11-PIR, 12-door sensor alarm, 13-call alarm    
    DWORD    dwAlarmChan;            //Alarm channel No.
    char    byAlarmTime[MAX_TIME_LEN];     //Alarm time, format:YYYY-MM-DD HH:MM:SS
    DWORD    dwCaptureChan;            //Picture capture channel
    char    byPicTime[MAX_TIME_LEN];                //Picture time, format:YYYY-MM-DD HH:MM:SS
    char    byPicUrl[MAX_URL_LEN];         //Picture url
    DWORD    dwManualSnapSeq;    // Sequence of manual capture picture, valid if wPicType is 2 or 3
    BYTE    byRetransFlag;                     //Retransmit flag, 0-real time package, 1-retransmit package
    BYTE    byRes[31];
}NET_EHOME_NOTICE_PICURL, *LPNET_EHOME_NOTICE_PICURL;

typedef struct tagNET_EHOME_NOTIFY_FAIL_INFO
{
    DWORD dwSize;
    char  byDeviceID[MAX_DEVICE_ID_LEN];   //Device register ID
    WORD  wFailedCommand;    //Fail command,1-capture picture fail
    WORD  wPicType;    
    //Picture type, valid if fail command is capture picture fail, 0-PU capture picture by time, 1-PU capture picture by alarm, 2-CU manual capture picture, 
    //3-CU download picture, 4-event trigger PU capture picture
    DWORD    dwManualSnapSeq;    // Sequence of manual capture picture, valid if wPicType is 2 or 3
    BYTE    byRetransFlag;                     //Retransmit flag, 0-real time package, 1-retransmit package
    BYTE    byRes[31];
}NET_EHOME_NOTIFY_FAIL_INFO, *LPNET_EHOME_NOTIFY_FAIL_INFO;

typedef struct tagNET_EHOME_ALARM_MSG
{
    DWORD dwAlarmType;      //device type, EN_ALARM_TYPE
    void *pAlarmInfo;       //The content of the alarm(structure)
    DWORD dwAlarmInfoLen;   //the length of alarm content(structure)
    void *pXmlBuf;          //the content of the alarm XML
    DWORD dwXmlBufLen;      //the length of alarm content(XML)
    char  sSerialNumber[12];
    BYTE    byDataType;        //alarm data type,0-XML, 1-structure
    void *pHttpUrl;
    DWORD dwHttpUrlLen;
    BYTE  byRes[23];     
}NET_EHOME_ALARM_MSG, *LPNET_EHOME_ALARM_MSG;

typedef BOOL (CALLBACK *MSGCallBack)(LONG iHandle, NET_EHOME_ALARM_MSG *pAlarmMsg, void *pUser);

typedef struct tagNET_EHOME_ALARM_LISTEN_PARAM
{
    NET_EHOME_IPADDRESS struAddress;  //Local listening information, if the IP address is *.0.0.0, it is considered as the local address. 
    MSGCallBack    fnMsgCb; // Alarm listening callback function 
    void * pUserData;   //User data 
    BYTE  byProtocolType;  //Connection mode, 0- TCP, 1- UDP 
    BYTE  byUseCmsPort; //Use CMS listen port,0-not use,!0-use，if use CMS port, byProtoclType is invalid , struAddress is loopback address
    BYTE  byUseThreadPool;  //0-use thread pool when callback alarm，1-dose not use thread pool when callback alarm. default: use thread pool
    BYTE  byRes[29];
}NET_EHOME_ALARM_LISTEN_PARAM, *LPNET_EHOME_ALARM_LISTEN_PARAM;


typedef struct tagNET_EHOME_ALARM_ISAPI_INFO
{
    char * pAlarmData;           
    DWORD dwAlarmDataLen;   
    BYTE byDataType;        // 0-invalid,1-xml,2-json
    BYTE byPicturesNumber;  //Pictures Number
    BYTE byRes[2];
    void * pPicPackData;         // byPicturesNumber NET_EHOME_ALARM_ISAPI_PICDATA
    BYTE byRes1[32];
}NET_EHOME_ALARM_ISAPI_INFO, *LPNET_EHOME_ALARM_ISAPI_INFO;

typedef struct tagNET_EHOME_ALARM_ISAPI_PICDATA
{
    DWORD dwPicLen;
    BYTE byRes[4];
    char szFilename[MAX_FILE_PATH_LEN]; 
    BYTE *pPicData;
}NET_EHOME_ALARM_ISAPI_PICDATA, *LPNET_EHOME_ALARM_ISAPI_PICDATA;

//Alarm Library Initialization
NET_DVR_API BOOL  CALLBACK NET_EALARM_Init();
NET_DVR_API BOOL  CALLBACK NET_EALARM_Fini();

//Return the error code.
NET_DVR_API DWORD CALLBACK NET_EALARM_GetLastError();

//log
NET_DVR_API BOOL CALLBACK NET_EALARM_SetLogToFile(LONG iLogLevel, const char *strLogDir, BOOL bAutoDel);

//Get the alarm library version
NET_DVR_API DWORD CALLBACK NET_EALARM_GetBuildVersion();

NET_DVR_API LONG CALLBACK NET_EALARM_StartListen(NET_EHOME_ALARM_LISTEN_PARAM *pAlarmListenParam);

NET_DVR_API BOOL CALLBACK NET_EALARM_StopListen(LONG iListenHandle);

NET_DVR_API BOOL  CALLBACK NET_EALARM_SetSDKLocalCfg(  NET_EHOME_LOCAL_CFG_TYPE enumType, void* const lpInBuff);
NET_DVR_API BOOL  CALLBACK NET_EALARM_GetSDKLocalCfg(NET_EHOME_LOCAL_CFG_TYPE enumType,void *lpOutBuff);


NET_DVR_API BOOL  CALLBACK NET_EALARM_SetDeviceSessionKey(NET_EHOME_DEV_SESSIONKEY* pDeviceKey);

NET_DVR_API BOOL  CALLBACK NET_EALARM_GetDeviceSessionKey(NET_EHOME_DEV_SESSIONKEY* pDeviceKey);

#endif //_HC_EHOME_ALARM_H_