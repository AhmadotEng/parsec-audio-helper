const $=id=>document.getElementById(id);let tabId=null,timer=null,busy=false;
async function call(action, extra={}){if(tabId===null)throw Error("Open https://web.parsec.app in the active tab.");let r;try{r=await chrome.tabs.sendMessage(tabId,{action,...extra})}catch(e){if(!/receiving end does not exist/i.test(e?.message||""))throw e;await chrome.scripting.executeScript({target:{tabId},files:["content.js"]});r=await chrome.tabs.sendMessage(tabId,{action,...extra})}if(!r||!r.ok)throw Error(r?.result?.error||r?.error||"Extension bridge unavailable. Reload the Parsec tab.");return r.result;}
function setError(e){$("error").textContent=e?.message||String(e)}
function fmt(n){return n<1024?`${Math.round(n)} B/s`:`${(n/1024).toFixed(1)} KiB/s`}
let prior=null,lastRate="Checking traffic…", userSelected=false;
function updateDevices(devices, mic, active){
  const sel=$("device"), chosen=sel.value;
  // Browsers expose the system default as an alias alongside the real device.
  const inputs=devices.filter(d=>d.deviceId && d.deviceId!=="default" && !/^default\s*[-–—]\s*/i.test(d.label));
  sel.replaceChildren(new Option("Default microphone",""),...inputs.map(d=>new Option(d.label||"Microphone",d.deviceId)));
  const available=id=>[...sel.options].some(o=>o.value===id);
  const current=active && mic.deviceLabel && inputs.find(d=>d.label===mic.deviceLabel);
  const airpods=inputs.find(d=>/airpods/i.test(d.label));
  if(current) sel.value=current.deviceId;
  else if(userSelected && available(chosen)) sel.value=chosen;
  else if(airpods) sel.value=airpods.deviceId;
  else if(available(chosen)) sel.value=chosen;
}
$("device").addEventListener("change",()=>{userSelected=true});
async function refresh(){try{const r=await call("status"),a=r.audio,m=r.mic;$("connection").textContent=a.connected?({direct:"Connected · Direct",wifi:"Connected · Wi-Fi",ethernet:"Connected · Ethernet",unknown:"Connected · Unknown route"}[r.path]||"Connected · Unknown route"):"Open host session";$("video").disabled=!a.connected||busy;$("video").textContent=a.videoPauseRequested?"Restore video":"Pause video";$("reset").disabled=!a.connected||busy;$("traffic").textContent=a.connected?(a.videoPauseRequested?"":"Video pause is off.\n")+lastRate:"Connect to a Parsec host first.";const active=m.state==="running"||m.state==="muted";$("mic").textContent=m.state==="starting"?"Waiting for microphone permission…":m.state==="running"?`Sending microphone audio\n${m.deviceLabel||""}\nFrames sent: ${m.sentFrames} · Dropped: ${m.droppedFrames}`:m.state==="muted"?"Microphone muted":"Microphone off";$("host").textContent=m.hostMicrophone==="enabled"?"Host microphone enabled. Check the Windows input meter.":m.hostMicrophone==="disabled"?"Parsec reports the host microphone is disabled.":"Host microphone status unknown; sent frames do not confirm Windows receives audio.";$("start").disabled=!a.connected||active||busy;$("mute").disabled=!active||busy;$("mute").textContent=m.muted?"Unmute":"Mute";$("stop").disabled=!active||busy;$("device").disabled=active||busy;updateDevices(r.devices,m,active);const now=performance.now(),x=r.metrics;if(x.monitoringAvailable){if(prior&&now-prior.t>=1000){const sec=(now-prior.t)/1000;lastRate=`PC audio: ${fmt((x.audioBytesReceived-prior.a)/sec)}\nPC video: ${fmt((x.videoBytesReceived-prior.v)/sec)}`}prior={t:now,a:x.audioBytesReceived,v:x.videoBytesReceived}}else{prior=null;lastRate="PC audio/video counters unavailable."}}catch(e){$("connection").textContent="Parsec tab required";$("traffic").textContent="Open or reload https://web.parsec.app, then reopen this popup.";setError(e)}}
async function action(fn){if(busy)return;busy=true;setError("");await refresh();try{await fn()}catch(e){setError(e)}finally{busy=false;await refresh()}}
(async()=>{try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab?.url?.startsWith("https://web.parsec.app/"))tabId=tab.id;else throw Error("The active tab is not web.parsec.app.");await refresh();timer=setInterval(refresh,750)}catch(e){setError(e);$("connection").textContent="Parsec tab required"}})();
$("video").onclick=()=>action(()=>call("video"));$("start").onclick=()=>action(()=>call("startMic",{deviceId:$("device").value}));$("mute").onclick=()=>action(async()=>{const r=await call("status");return call("mute",{value:!r.mic.muted})});$("stop").onclick=()=>action(()=>call("stopMic"));$("reset").onclick=()=>action(async()=>{await call("reset");clearInterval(timer);await refresh()});
