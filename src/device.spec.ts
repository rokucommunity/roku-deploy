import * as fsExtra from 'fs-extra';
import type { RokuDeployOptions } from './index';
import { rokuDeploy } from './index';
import { cwd, outDir, rootDir, tempDir, writeFiles } from './testUtils.spec';
import * as dedent from 'dedent';

//these tests are run against an actual roku device. These cannot be enabled when run on the CI server
describe('device', function device() {
    let options: RokuDeployOptions;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        process.chdir(rootDir);
        options = rokuDeploy.getOptions({
            outDir: outDir,
            host: '192.168.1.32',
            retainDeploymentArchive: true,
            password: 'aaaa',
            devId: 'c6fdc2019903ac3332f624b0b2c2fe2c733c3e74',
            rekeySignedPackage: `${cwd}/testSignedPackage.pkg`,
            signingPassword: 'drRCEVWP/++K5TYnTtuAfQ=='
        });

        writeFiles(rootDir, [
            ['manifest', dedent`
                title=RokuDeployTestChannel
                major_version=1
                minor_version=0
                build_version=0
                splash_screen_hd=pkg:/images/splash_hd.jpg
                ui_resolutions=hd
                bs_const=IS_DEV_BUILD=false
                splash_color=#000000
            `],
            ['source/main.brs', dedent`
                Sub RunUserInterface()
                    screen = CreateObject("roSGScreen")
                    m.scene = screen.CreateScene("HomeScene")
                    port = CreateObject("roMessagePort")
                    screen.SetMessagePort(port)
                    screen.Show()

                    while(true)
                        msg = wait(0, port)
                    end while

                    if screen <> invalid then
                        screen.Close()
                        screen = invalid
                    end if
                End Sub
            `]
        ]);
    });

    afterEach(() => {
        //restore the original working directory
        process.chdir(cwd);
        fsExtra.emptyDirSync(tempDir);
    });

    this.timeout(20000);
    console.log(options); // So there are no errors about unused variable
});
