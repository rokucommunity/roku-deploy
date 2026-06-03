import * as fsExtra from 'fs-extra';
import { cwd, rootDir, tempDir, writeFiles } from './testUtils.spec';
import undent from 'undent';

//these tests are run against an actual roku device. These cannot be enabled when run on the CI server
describe('device', function device() {

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        process.chdir(rootDir);

        writeFiles(rootDir, [
            ['manifest', undent`
                title=RokuDeployTestChannel
                major_version=1
                minor_version=0
                build_version=0
                splash_screen_hd=pkg:/images/splash_hd.jpg
                ui_resolutions=hd
                bs_const=IS_DEV_BUILD=false
                splash_color=#000000
            `],
            ['source/main.brs', undent`
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
});
