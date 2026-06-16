import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { AppServerConfig } from './app/app.config.server';
import { App } from './app/app';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, AppServerConfig, context);

export default bootstrap;
