const {Arch}=require('builder-util');

// The pinned document extraction engine currently publishes macOS arm64 only.
// Do not produce an Intel app that appears complete but cannot open documents.
module.exports = async function checkMacPlatform(context){
  if(context.electronPlatformName==='darwin'&&context.arch!==Arch.arm64){
    throw Error('This Mac preview supports Apple Silicon only. Xberg 1.3.7 does not provide a macOS Intel runtime.');
  }
  if(context.electronPlatformName==='darwin'){
    // Electron installs its checksummed runtime on first use. A clean npm ci
    // contains only the package, without the Chromium notice we verify below.
    require('electron');
    await import('./build-app-icon.mjs');
    const {prepareDistributionNotices}=await import('./prepare-distribution-notices.mjs');
    await prepareDistributionNotices();
  }
};
