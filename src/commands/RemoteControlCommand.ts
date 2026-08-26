import * as readline from 'readline';
import { rokuDeploy } from '../index';
import type { RemoteKeyText } from '../index';

export class RemoteControlCommand {
    run(args) {
        let options = {
            ...rokuDeploy.loadConfigFile(args),
            ...args
        };

        rokuDeploy.checkRequiredOptions(options, ['host']);

        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            const keyName = key.name as unknown;
            let rokuDeployKeyName: RemoteKeyText | undefined;
            switch (keyName) {
                case 'home':
                    rokuDeployKeyName = 'Home';
                    break;
                case 'escape':
                    rokuDeployKeyName = 'Back';
                    break;
                case 'delete':
                    if (key.ctrl || key.meta || key.shift) {
                        rokuDeployKeyName = 'Backspace';
                    }
                    rokuDeployKeyName = 'Back';
                    break;
                case 'backspace':
                    if (key.ctrl || key.meta || key.shift) {
                        rokuDeployKeyName = 'Backspace';
                    } else {
                        rokuDeployKeyName = 'InstantReplay';
                    }
                    break;
                case 'end':
                    rokuDeployKeyName = 'Play';
                    break;
                case 'return':
                    rokuDeployKeyName = 'Select';
                    break;
                case 'up':
                    rokuDeployKeyName = 'Up';
                    if (key.shift) {
                        rokuDeployKeyName = 'VolumeUp';
                    }
                    break;
                case 'down':
                    rokuDeployKeyName = 'Down';
                    if (key.shift) {
                        rokuDeployKeyName = 'VolumeDown';
                    }
                    break;
                case 'left':
                    rokuDeployKeyName = 'Left';
                    if (key.shift) {
                        rokuDeployKeyName = 'Rev';
                    }
                    break;
                case 'right':
                    rokuDeployKeyName = 'Right';
                    if (key.shift) {
                        rokuDeployKeyName = 'Fwd';
                    }
                    break;
                default:
                    if (key.sequence === '*') {
                        rokuDeployKeyName = 'Info';
                    } else {
                        if (key.ctrl && key.name === 'c') {
                            process.exit();
                        }

                        let text = key.name;
                        if (text === undefined) {
                            text = key.sequence;
                        }

                        if (text === 'space') {
                            text = ' ';
                        }

                        void rokuDeploy.sendText({
                            text: text, ...options
                        });
                    }
                    break;
            }

            if (rokuDeployKeyName) {
                void rokuDeploy.keyPress({ key: rokuDeployKeyName, ...options });
            }
        });

        console.log('Now receiving keyboard input. Press Ctrl+C to exit.\nescape=back, end=play, return=select, shift+left=rev, shift+right=fwd, shift+up=volumeup, shift+down=volumedown, *=options');
    }
}
