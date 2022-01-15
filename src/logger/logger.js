class Logger {
    constructor(console, env) {
        this.console = console;
        this.env = env;
    }

    debug(message, ...args) {
        if (this.env !== 'development') {
            return;
        }

        this.console.debug(message, ...args);
    }

    info(message, ...args) {
        this.console.info(message, ...args);
    }

    warn(message, ...args) {
        this.console.warn(message, ...args);
    }

    error(message, ...args) {
        this.console.error(message, ...args);
    }
}

export default Logger;