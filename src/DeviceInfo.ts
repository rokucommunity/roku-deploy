export interface DeviceInfoResult {
    /**
     * The host used to fetch this `device-info` response. If an alpha-numeric host was given, this will be the dns-resolved IP address
     * @example 192.168.1.10
     */
    host: string;
    /**
     * The port used to run the `device-info` request
     * @example 8060
     */
    port: number;
    /**
     * The full device-info URL
     * @example "http://192.168.1.10:8060/query/device-info"
     */
    url: string;
    /**
     * All of the `device-info` data retrieved from the device.
     * Any "true" and "false" values have been converted to booleans, and strings containing just numbers have been converted to proper numbers
     */
    deviceInfo: {
        'udn'?: string;
        'serial-number'?: string;
        'device-id'?: string;
        'advertising-id'?: string;
        'vendor-name'?: string;
        'model-name'?: string;
        'model-number'?: string;
        'model-region'?: string;
        'is-tv'?: boolean;
        'is-stick'?: boolean;
        'mobile-has-live-tv'?: boolean;
        'ui-resolution'?: string;
        'supports-ethernet'?: boolean;
        'wifi-mac'?: string;
        'wifi-driver'?: string;
        'has-wifi-extender'?: boolean;
        'has-wifi-5G-support'?: boolean;
        'can-use-wifi-extender'?: boolean;
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
        'software-build'?: number;
        'secure-device'?: boolean;
        'language'?: string;
        'country'?: string;
        'locale'?: string;
        'time-zone-auto'?: boolean;
        'time-zone'?: string;
        'time-zone-name'?: string;
        'time-zone-tz'?: string;
        'time-zone-offset'?: number;
        'clock-format'?: string;
        'uptime'?: number;
        'power-mode'?: string;
        'supports-suspend'?: boolean;
        'supports-find-remote'?: boolean;
        'find-remote-is-possible'?: boolean;
        'supports-audio-guide'?: boolean;
        'supports-rva'?: boolean;
        'has-hands-free-voice-remote'?: boolean;
        'developer-enabled'?: boolean;
        'keyed-developer-id'?: string;
        'search-enabled'?: boolean;
        'search-channels-enabled'?: boolean;
        'voice-search-enabled'?: boolean;
        'notifications-enabled'?: boolean;
        'notifications-first-use'?: boolean;
        'supports-private-listening'?: boolean;
        'headphones-connected'?: boolean;
        'supports-audio-settings'?: boolean;
        'supports-ecs-textedit'?: boolean;
        'supports-ecs-microphone'?: boolean;
        'supports-wake-on-wlan'?: boolean;
        'supports-airplay'?: boolean;
        'has-play-on-roku'?: boolean;
        'has-mobile-screensaver'?: boolean;
        'support-url'?: string;
        'grandcentral-version'?: string;
        'trc-version'?: number;
        'trc-channel-version'?: string;
        'davinci-version'?: string;
        'av-sync-calibration-enabled'?: number;
        'brightscript-debugger-version'?: string;
        // catchall index lookup for keys we weren't aware of
        [key: string]: any;
    };
}
