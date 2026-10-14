/* ULTRALINK hardware setup: OS-paired Bluetooth/USB microphones and standard
   keyboard/HID PTT buttons. No proprietary Bluetooth protocol or background hotkeys. */
(function(global){'use strict';
class HardwarePTT {
  constructor(opts){
    this.opts=opts;this.config={key:'',mode:'hold',limit:60};
    try{Object.assign(this.config,JSON.parse(localStorage.ulHardwarePTT||'{}'));}catch(e){}
    if(!['hold','toggle'].includes(this.config.mode))this.config.mode='hold';this.config.limit=60;
    this.root=null;this.learning=false;this.testing=false;this.down=false;this.active=false;this.status='PAIR IN WINDOWS / macOS FIRST, THEN REFRESH THE DEVICE LIST.';
    addEventListener('keydown',e=>this.keyDown(e),true);addEventListener('keyup',e=>this.keyUp(e),true);
    addEventListener('blur',()=>this.release('WINDOW LOST FOCUS — PTT RELEASED'));
    document.addEventListener('focusin',e=>{if(this.active&&this.blockedTarget(e))this.release('INPUT OR DIALOG FOCUSED — PTT RELEASED');});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release('PAGE HIDDEN — PTT RELEASED');});
    navigator.mediaDevices?.addEventListener('devicechange',()=>this.devicesChanged());
  }
  async reset(){this.release('HARDWARE SETTINGS RESET');this.config={key:'',mode:'hold',limit:60};this.save();this.drawBinding();if(this.opts.getVoice())await this.chooseInput('');else{try{localStorage.ulAudioInput='';}catch(e){}}}
  save(){try{localStorage.ulHardwarePTT=JSON.stringify(this.config);}catch(e){}}
  el(id){return this.root?.querySelector('[data-hw="'+id+'"]');}
  show(text){this.status=text;const e=this.el('status');if(e)e.textContent=text;}
  attachVoice(voice){voice.on('micstate',s=>{if(!s.ready){this.release('MICROPHONE UNAVAILABLE — PTT RELEASED');this.show(s.reason+' — RECONNECT OR SELECT A DIFFERENT INPUT.');}else this.show('MIC READY: '+s.label);});}
  blockedTarget(e){return e.target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName)||!!document.querySelector('dialog[open]');}
  consume(e){e.preventDefault();e.stopImmediatePropagation();}
  keyDown(e){
    if(this.learning){
      this.consume(e);if(e.repeat)return;
      if(e.code==='Escape'){this.cancelLearn();return;}
      if(!e.code||e.code==='Unidentified'||/^(Shift|Control|Alt|Meta)/.test(e.code)||['Tab','CapsLock','NumLock'].includes(e.code)||e.ctrlKey||e.altKey||e.metaKey){this.show('PRESS THE PTT BUTTON ALONE — NOT A MODIFIER OR SYSTEM SHORTCUT.');return;}
      this.config.key=e.code;if(/^Media|^Audio/.test(e.code))this.config.mode='toggle';this.save();this.learning=false;clearTimeout(this.learnTimer);this.down=true;this.justLearned=true;
      this.drawBinding();this.show('LEARNED '+e.code+'. RELEASE IT, THEN TEST. LEARNING DID NOT TRANSMIT.');return;
    }
    if(!this.config.key||e.code!==this.config.key)return;
    if(!this.testing&&this.blockedTarget(e))return;
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    this.consume(e);if(e.repeat||this.down)return;this.down=true;
    if(this.config.mode==='toggle')setTimeout(()=>{this.down=false;},150);
    if(this.testing){this.show('TEST: BUTTON PRESSED ('+e.code+') — NO RADIO TRANSMISSION.');return;}
    if(this.config.mode==='toggle'&&this.active){this.release('PTT CLOSED');this.down=true;return;}
    const voice=this.opts.getVoice();
    if(!this.opts.canTransmit()||!voice?.track||voice.track.readyState!=='live'){this.show('PTT NOT OPENED — CHECK MIC, LINK AND NORMAL RADIO MODE.');return;}
    this.opts.start();this.active=!!this.opts.transmitting();
    if(this.active){this.show('PHYSICAL PTT TRANSMITTING TO ALL UNITS');this.timer=setTimeout(()=>{this.release('60-SECOND SAFETY LIMIT — RELEASE AND PRESS AGAIN');this.down=this.config.mode==='hold';},this.config.limit*1000);}
  }
  keyUp(e){
    if(!this.config.key||e.code!==this.config.key)return;
    if(!this.down&&!this.active&&!this.testing)return;this.consume(e);this.down=false;
    if(this.justLearned){this.justLearned=false;this.show('BUTTON LEARNED AND RELEASED — USE DRY TEST BEFORE LIVE PTT.');return;}
    if(this.testing){this.show('TEST: BUTTON RELEASED — PRESS/RELEASE EVENTS RECEIVED. NO TRANSMISSION.');return;}
    if(this.config.mode==='hold')this.release('PTT CLOSED');
  }
  release(reason){clearTimeout(this.timer);this.timer=null;this.active=false;this.down=false;this.opts.stop();if(reason)this.show(reason);}
  drawBinding(){if(this.el('binding'))this.el('binding').textContent=this.config.key||'NO PHYSICAL BUTTON LEARNED';if(this.el('mode'))this.el('mode').value=this.config.mode;if(this.el('learn'))this.el('learn').textContent=this.learning?'WAITING FOR BUTTON…':'LEARN PTT BUTTON';}
  cancelLearn(){this.learning=false;this.down=false;clearTimeout(this.learnTimer);this.drawBinding();this.show('LEARNING CANCELLED — CURRENT BINDING KEPT.');}
  async listDevices(permission=false){
    if(!navigator.mediaDevices?.enumerateDevices){this.show('AUDIO DEVICE LIST UNAVAILABLE — USE HTTPS AND A SUPPORTED BROWSER.');return;}
    try{
      if(permission){const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());}
      const all=await navigator.mediaDevices.enumerateDevices();this.devices=all.filter(d=>d.kind==='audioinput');
      const select=this.el('input');if(!select)return;select.replaceChildren();select.append(new Option('Default — system microphone',''));
      this.devices.filter(d=>d.deviceId&&d.deviceId!=='default').forEach((d,i)=>select.append(new Option(d.label||'Microphone '+(i+1)+' — allow access to show its name',d.deviceId)));
      const id=this.opts.getVoice()?.inputDeviceId||localStorage.ulAudioInput||'';
      if(id&&!this.devices.some(d=>d.deviceId===id))select.append(new Option('Saved microphone — currently unavailable',id));select.value=id;
      if(permission)this.show('DEVICE LIST REFRESHED. SELECT A MICROPHONE TO CONNECT IT.');
    }catch(e){this.show('DEVICE ACCESS FAILED: '+(e.message||e.name));}
  }
  async chooseInput(id){
    const selection = this.selectionSeq = (this.selectionSeq || 0) + 1;
    this.release('CHANGING MICROPHONE — PTT RELEASED');this.stopMeter();
    const old=this.opts.getVoice()?.inputDeviceId||localStorage.ulAudioInput||'';
    try{
      const voice=this.opts.getVoice();
      if(voice){await voice.selectMicrophone(id);if(selection!==this.selectionSeq)return;if(this.el('input'))this.el('input').value=id;this.show('CONNECTED MICROPHONE: '+(voice.track?.label||'system default'));}
      else{const stream=await navigator.mediaDevices.getUserMedia({audio:id?{deviceId:{exact:id}}:true});stream.getTracks().forEach(t=>t.stop());if(selection!==this.selectionSeq)return;localStorage.ulAudioInput=id;if(this.el('input'))this.el('input').value=id;this.show('MICROPHONE SAVED — USED WHEN YOU ENTER A MISSION.');}
    }catch(e){if(selection!==this.selectionSeq)return;if(this.el('input'))this.el('input').value=old;this.show('MIC CHANGE FAILED: '+(e.message||e.name)+'. PREVIOUS INPUT KEPT; NO SILENT FALLBACK.');}
  }
  async devicesChanged(){
    const id=this.opts.getVoice()?.inputDeviceId||localStorage.ulAudioInput||'';
    try{const devices=await navigator.mediaDevices.enumerateDevices();if(id&&!devices.some(d=>d.kind==='audioinput'&&d.deviceId===id)){this.release('SELECTED MICROPHONE DISCONNECTED — PTT RELEASED');this.opts.getVoice()?.invalidateMicrophone('SELECTED MICROPHONE DISCONNECTED');this.show('SELECTED MICROPHONE UNAVAILABLE. RECONNECT IT OR EXPLICITLY CHOOSE ANOTHER INPUT.');}
      else if(id&&this.opts.getVoice()&&!this.opts.getVoice().track)await this.opts.getVoice().recover();
      await this.listDevices(false);}catch(e){}
  }
  async startMeter(){
    this.release('LOCAL MICROPHONE TEST — NO RADIO TRANSMISSION');this.stopMeter();
    try{const voice=this.opts.getVoice();if(!voice)throw new Error('ENTER A MISSION FIRST');const stream=await voice.mic();const c=voice.audioCtx();this.meterSource=c.createMediaStreamSource(stream);this.analyser=c.createAnalyser();this.analyser.fftSize=512;this.meterSource.connect(this.analyser);const data=new Uint8Array(512);
      const tick=()=>{if(!this.root?.isConnected||!this.analyser){this.stopMeter();return;}this.analyser.getByteTimeDomainData(data);let sum=0;for(const x of data)sum+=((x-128)/128)**2;const value=Math.min(100,Math.round(Math.sqrt(sum/data.length)*250));const meter=this.el('meter');if(meter)meter.value=value;this.meterFrame=requestAnimationFrame(tick);};tick();this.show('SPEAK INTO THE SELECTED MIC. THE LEVEL METER IS LOCAL; NOTHING IS TRANSMITTED.');
    }catch(e){this.show('MIC TEST FAILED: '+(e.message||e.name));}
  }
  stopMeter(){cancelAnimationFrame(this.meterFrame);try{this.meterSource?.disconnect();}catch(e){}this.meterSource=null;this.analyser=null;const meter=this.el('meter');if(meter)meter.value=0;}
  unmount(){this.stopMeter();this.testing=false;this.learning=false;clearTimeout(this.learnTimer);this.root=null;}
  mount(root){this.unmount();this.root=root;
    root.innerHTML='<section class="hw-panel"><h3>BLUETOOTH / USB AUDIO &amp; PHYSICAL PTT</h3><p class="hw-note">Pair your device in Windows/macOS first. ULTRALINK supports microphones exposed as standard audio inputs and PTT buttons that send keyboard/HID key events to this page. Proprietary radio-only buttons need device-specific integration.</p><button type="button" data-hw="refresh">ALLOW MIC ACCESS / REFRESH DEVICES</button><label for="hwInput">Audio input</label><select id="hwInput" data-hw="input"><option value="">Default — system microphone</option></select><div class="hw-row"><button type="button" data-hw="default">USE SYSTEM DEFAULT</button><button type="button" data-hw="micTest">TEST MIC LEVEL</button><button type="button" data-hw="meterStop">STOP MIC TEST</button></div><meter data-hw="meter" min="0" max="100" value="0" aria-label="Local microphone level"></meter><div class="hw-divider"><label>Physical PTT button · broadcasts to all units</label><div class="hw-key" data-hw="binding"></div><div class="hw-row"><button type="button" data-hw="learn">LEARN PTT BUTTON</button><button type="button" data-hw="clear">CLEAR BUTTON</button><button type="button" data-hw="test" aria-pressed="false">TEST BUTTON — NO TX</button></div><label for="hwMode">Button behavior</label><select id="hwMode" data-hw="mode"><option value="hold">Hold — press / release</option><option value="toggle">Toggle — tap on / off</option></select><p class="hw-note">The learned key overrides any shortcut using that same key; prefer an unused key. Keep this window focused. Typing and dialogs cannot start transmission. Loss of focus, link loss, mic loss or the 60-second safety limit closes PTT. Media buttons work only when the browser receives their events; OS-intercepted buttons cannot be learned here.</p></div><div class="hw-status" data-hw="status" role="status" aria-live="polite"></div></section>';
    this.drawBinding();this.show(this.status);this.listDevices(false);
    this.el('refresh').onclick=()=>this.listDevices(true);this.el('input').onchange=e=>this.chooseInput(e.target.value);this.el('default').onclick=()=>this.chooseInput('');
    this.el('micTest').onclick=()=>this.startMeter();this.el('meterStop').onclick=()=>{this.stopMeter();this.show('LOCAL MIC TEST STOPPED');};
    this.el('learn').onclick=()=>{this.release();this.stopMeter();this.testing=false;this.el('test').setAttribute('aria-pressed','false');this.learning=true;this.drawBinding();this.show('PRESS AND RELEASE YOUR PHYSICAL PTT BUTTON NOW. ESCAPE CANCELS. NO TRANSMISSION.');this.learnTimer=setTimeout(()=>{if(this.learning){this.cancelLearn();this.show('NO BUTTON EVENT RECEIVED. CHECK PAIRING / FOCUS; THIS BUTTON MAY USE AN UNSUPPORTED PROTOCOL.');}},15000);};
    this.el('clear').onclick=()=>{this.release();this.cancelLearn();this.config.key='';this.save();this.drawBinding();this.show('PHYSICAL BINDING CLEARED. NORMAL SPACE / ON-SCREEN PTT STILL WORK.');};
    this.el('test').onclick=()=>{this.release();this.testing=!this.testing;this.el('test').setAttribute('aria-pressed',String(this.testing));this.show(this.testing?'DRY BUTTON TEST ACTIVE — PRESS/RELEASE THE LEARNED BUTTON. NO TX.':'BUTTON TEST STOPPED');};
    this.el('mode').onchange=e=>{this.release();this.config.mode=e.target.value;this.save();this.show('BUTTON MODE: '+this.config.mode.toUpperCase());};
    const dialog=root.closest('dialog');if(dialog){this.dialogClose=()=>{this.unmount();};dialog.addEventListener('close',this.dialogClose,{once:true});}
  }
}
global.UL.HardwarePTT=HardwarePTT;
})(window);
