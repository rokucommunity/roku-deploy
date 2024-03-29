//there are 2 copies of this interface in here. If you add a new field, be sure to add it to both

export interface DeviceInfo {
    udn?: string;
    serialNumber?: string;
    deviceId?: string;
    advertisingId?: string;
    vendorName?: string;
    modelName?: string;
    modelNumber?: string;
    modelRegion?: string;
    isTv?: boolean;
    isStick?: boolean;
    mobileHasLiveTv?: boolean;
    uiResolution?: string;
    supportsEthernet?: boolean;
    wifiMac?: string;
    wifiDriver?: string;
    hasWifiExtender?: boolean;
    hasWifi5GSupport?: boolean;
    canUseWifiExtender?: boolean;
    ethernetMac?: string;
    networkType?: string;
    networkName?: string;
    friendlyDeviceName?: string;
    friendlyModelName?: string;
    defaultDeviceName?: string;
    userDeviceName?: string;
    userDeviceLocation?: string;
    buildNumber?: string;
    softwareVersion?: string;
    softwareBuild?: number;
    secureDevice?: boolean;
    language?: string;
    country?: string;
    locale?: string;
    timeZoneAuto?: boolean;
    timeZone?: string;
    timeZoneName?: string;
    timeZoneTz?: string;
    timeZoneOffset?: number;
    clockFormat?: string;
    uptime?: number;
    powerMode?: string;
    supportsSuspend?: boolean;
    supportsFindRemote?: boolean;
    findRemoteIsPossible?: boolean;
    supportsAudioGuide?: boolean;
    supportsRva?: boolean;
    hasHandsFreeVoiceRemote?: boolean;
    developerEnabled?: boolean;
    keyedDeveloperId?: string;
    searchEnabled?: boolean;
    searchChannelsEnabled?: boolean;
    voiceSearchEnabled?: boolean;
    notificationsEnabled?: boolean;
    notificationsFirstUse?: boolean;
    supportsPrivateListening?: boolean;
    headphonesConnected?: boolean;
    supportsAudioSettings?: boolean;
    supportsEcsTextedit?: boolean;
    supportsEcsMicrophone?: boolean;
    supportsWakeOnWlan?: boolean;
    supportsAirplay?: boolean;
    hasPlayOnRoku?: boolean;
    hasMobileScreensaver?: boolean;
    supportUrl?: string;
    grandcentralVersion?: string;
    trcVersion?: number;
    trcChannelVersion?: string;
    davinciVersion?: string;
    avSyncCalibrationEnabled?: number;
    brightscriptDebuggerVersion?: string;
}

export interface DeviceInfoRaw {
    'udn'?: string;
    'serialNumber'?: string;
    'deviceId'?: string;
    'advertising-id'?: string;
    'vendor-name'?: string;
    'model-name'?: string;
    'model-number'?: string;
    'model-region'?: string;
    'is-tv'?: string;
    'is-stick'?: string;
    'mobile-has-live-tv'?: string;
    'ui-resolution'?: string;
    'supports-ethernet'?: string;
    'wifi-mac'?: string;
    'wifi-driver'?: string;
    'has-wifi-extender'?: string;
    'has-wifi-5G-support'?: string;
    'can-use-wifi-extender'?: string;
    'ethernet-mac'?: string;
    'network-type'?: string;
    'network-name'?: string;
    'friendly-device-name'?: string;
    'friendly-model-name'?: string;
    'default-device-name'?: string;
    'user-device-name'?: string;
    'user-device-location'?: string;
    'build-number'?: string;
    'software-version'?: string;
    'software-build'?: string;
    'secure-device'?: string;
    'language'?: string;
    'country'?: string;
    'locale'?: string;
    'time-zone-auto'?: string;
    'time-zone'?: string;
    'time-zone-name'?: string;
    'time-zone-tz'?: string;
    'time-zone-offset'?: string;
    'clock-format'?: string;
    'uptime'?: string;
    'power-mode'?: string;
    'supports-suspend'?: string;
    'supports-find-remote'?: string;
    'find-remote-is-possible'?: string;
    'supports-audio-guide'?: string;
    'supports-rva'?: string;
    'has-hands-free-voice-remote'?: string;
    'developer-enabled'?: string;
    'keyed-developer-id'?: string;
    'search-enabled'?: string;
    'search-channels-enabled'?: string;
    'voice-search-enabled'?: string;
    'notifications-enabled'?: string;
    'notifications-first-use'?: string;
    'supports-private-listening'?: string;
    'headphones-connected'?: string;
    'supports-audio-settings'?: string;
    'supports-ecs-textedit'?: string;
    'supports-ecs-microphone'?: string;
    'supports-wake-on-wlan'?: string;
    'supports-airplay'?: string;
    'has-play-on-roku'?: string;
    'has-mobile-screensaver'?: string;
    'support-url'?: string;
    'grandcentral-version'?: string;
    'trc-version'?: string;
    'trc-channel-version'?: string;
    'davinci-version'?: string;
    'av-sync-calibration-enabled'?: string;
    'brightscript-debugger-version'?: string;
    // catchall index lookup for keys we weren't aware of
    [key: string]: any;
}
