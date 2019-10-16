#!/usr/bin/env node
import { deploy } from './index';
deploy().then((...args) => {
    console.log(...args);
}, (...args) => {
    console.error(...args);
});
