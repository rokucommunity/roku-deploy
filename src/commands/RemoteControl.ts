import * as readline from 'readline';
import type { RokuKey } from '../index';
import { rokuDeploy, util } from '../index';

export class RemoteControl {
    run(args) {
        let options = {
            ...util.getOptionsFromJson(args),
            ...args
        };

        if (!options.host) {
            console.error('Host is required and neither supplied via --host or in your rokudeploy.json file');
            return;
        }

        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);

        process.stdin.on('keypress', (str, key) => {
            const keyName = key.name as unknown;
            let rokuDeployKeyName: RokuKey | undefined;
            switch (keyName) {
                case 'home':
                    rokuDeployKeyName = keyName;
                    break;
                case 'escape':
                    rokuDeployKeyName = 'back';
                    break;
                case 'delete':
                    if (key.ctrl || key.meta || key.shift) {
                        rokuDeployKeyName = 'backspace';
                    }
                    rokuDeployKeyName = 'back';
                    break;
                case 'backspace':
                    if (key.ctrl || key.meta || key.shift) {
                        rokuDeployKeyName = 'backspace';
                    } else {
                        rokuDeployKeyName = 'instantreplay';
                    }
                    break;
                case 'end':
                    rokuDeployKeyName = 'play';
                    break;
                case 'return':
                    rokuDeployKeyName = 'select';
                    break;
                case 'up':
                    rokuDeployKeyName = 'up';
                    if (key.shift) {
                        rokuDeployKeyName = 'volumeup';
                    }
                    break;
                case 'down':
                    rokuDeployKeyName = 'down';
                    if (key.shift) {
                        rokuDeployKeyName = 'volumedown';
                    }
                    break;
                case 'left':
                    rokuDeployKeyName = 'left';
                    if (key.shift) {
                        rokuDeployKeyName = 'rev';
                    }
                    break;
                case 'right':
                    rokuDeployKeyName = 'right';
                    if (key.shift) {
                        rokuDeployKeyName = 'fwd';
                    }
                    break;
                default:
                    if (key.sequence === '*') {
                        rokuDeployKeyName = 'info';
                    } else {
                        if (key.ctrl && key.name === 'c') {
                            process.exit(); // We provide a way to exit the program
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
