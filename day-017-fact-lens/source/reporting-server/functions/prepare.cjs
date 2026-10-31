const {copyFileSync}=require('node:fs');const {join}=require('node:path');copyFileSync(join(__dirname,'../../shared/diagnostics.mjs'),join(__dirname,'diagnostics.mjs'));
