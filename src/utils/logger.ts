export class Logger {

  private service: string;

  constructor(service: string) {
    this.service = service
  }

  public log(...data: any) {
    console.log(
      `\x1b[32m[${this.service}Logger] - \x1b[0m${new Date().toLocaleString()} \x1b \x1b[0m`,
      ...data,
    );
  }

  public error(...data: any) {
    console.log(
      `\x1b[32m[${this.service}Logger] - \x1b[0m${new Date().toLocaleString()} \x1b \x1b[0m`,
    );
  }

}