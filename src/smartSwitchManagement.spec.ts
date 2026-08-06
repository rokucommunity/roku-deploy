import * as TuyaDeviceModule from 'tuyapi';
const TuyaDevice = TuyaDeviceModule as unknown as typeof TuyaDeviceModule.default;

/**
 * Power-cycles the Roku via a Tuya/SmartLife smart plug it's plugged into, for a hard reboot when the
 * Roku's own software reboot isn't enough.
 */
export async function powerCycleRokuDevice(offMs = 5000): Promise<void> {
    const deviceId = process.env.TUYA_DEVICE_ID;
    const localKey = process.env.TUYA_LOCAL_KEY;
    const ip = process.env.TUYA_DEVICE_IP;

    if (!deviceId || !localKey || !ip) {
        throw new Error(
            'Missing Tuya smart plug connection info. Set TUYA_DEVICE_ID, TUYA_LOCAL_KEY, and TUYA_DEVICE_IP ' +
            'in your .env file (see .env.example) or as environment variables before running the device tests.'
        );
    }

    const device = new TuyaDevice({
        id: deviceId,
        key: localKey,
        ip: ip,
        //these smart plugs use protocol 3.4; tuyapi's default (3.3) connects but the device silently
        //drops the session before any get/set completes, so this must be set explicitly
        version: '3.4'
    });

    try {
        await device.connect();
        //dps 1 is the standard "switch on/off" data point on Tuya smart plugs
        await device.set({ dps: 1, set: false });
        await sleep(offMs);
        await device.set({ dps: 1, set: true });
    } finally {
        device.disconnect();
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}
