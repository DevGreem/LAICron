#!/usr/bin/env node
/* global process */
import { main } from "../dist/main.js";

process.exitCode = await main(process.argv.slice(2));
