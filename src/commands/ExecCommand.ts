export class ExecCommand {
    constructor({actions: string }){
        this.actions = options.actions.split('|');
    }

    run() {
        if(this.actions.includes('stage')){
            rokuDeploy.stage();
        }

        if(this.actions.includes('zip')){
            rokuDeploy.zip();
        }
    }
}