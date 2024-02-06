export class ExecCommand {
    constructor(options: {actions: string, configPath: string, ...rokuDeployOptions }){
        this.actions = options.actions.split('|');
    }

    run() {
        //load options from json
        const options = {
            ...getFromJson(this.configPath ?? `${cwd}/rokudeploy.json`),
            this.options
        };
        
        if(this.actions.includes('stage')){
            rokuDeploy.stage();
        }

        if(this.actions.includes('zip')){
            rokuDeploy.zip();
        }
    }
}