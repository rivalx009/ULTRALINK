/* Current model conditions and next six hourly forecasts. Not a live sensor feed. */
(function(){'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
const label=code=>code===0?'Clear':code<=3?'Cloudy':code<=48?'Fog':code<=57?'Drizzle':code<=67?'Rain':code<=77?'Snow':code<=82?'Rain showers':code<=86?'Snow showers':code<=99?'Thunderstorm':'Unknown';
class WeatherWidget{
 constructor(getLocation){this.getLocation=getLocation;this.cache=new Map();this.seq=0;this.controller=null;this.error='';this.loading=false;this.activeKey='';this.data=null;this.fetched=0;this.retryAt=0;
  this.el=document.createElement('section');this.el.id='weatherWidget';this.el.setAttribute('aria-label','Weather forecast');
  this.el.innerHTML='<header><strong>WEATHER · MODEL FORECAST</strong><button type="button" data-refresh title="Refresh forecast">↻</button><button type="button" data-toggle aria-expanded="false" title="Expand weather">+</button></header><div class="weather-body"></div>';
  this.el.classList.toggle('is-min',localStorage.ulWeatherMin!=='0');
  this.el.querySelector('[data-toggle]').onclick=()=>{this.el.classList.toggle('is-min');localStorage.ulWeatherMin=this.el.classList.contains('is-min')?'1':'0';this.syncToggle();dispatchEvent(new CustomEvent('ul-weather-toggle',{detail:{expanded:!this.el.classList.contains('is-min')}}));this.update();};
  this.el.querySelector('[data-refresh]').onclick=()=>this.update(true);this.syncToggle();
  this.mount();this.update();this.timer=setInterval(()=>{this.mount();this.update();},2000);addEventListener('online',()=>this.update(true));
 }
 mount(){const ops=document.getElementById('shell'),home=document.getElementById('home');const active=ops&&getComputedStyle(ops).display!=='none';const host=active?ops:home;if(!host)return;if(this.el.parentNode!==host){if(active)host.insertBefore(this.el,document.getElementById('main'));else host.append(this.el);}this.el.classList.toggle('weather-planning',!active);}
 syncToggle(){const min=this.el.classList.contains('is-min'),b=this.el.querySelector('[data-toggle]');b.textContent=min?'+':'−';b.setAttribute('aria-expanded',String(!min));b.title=min?'Expand weather':'Minimise weather';}
 async update(force=false){const p=this.getLocation();this.location=p;const key=valid(p)?p.lat.toFixed(2)+','+p.lon.toFixed(2):'';
  if(!key){if(this.activeKey){this.seq++;this.controller?.abort();}this.activeKey='';this.data=null;this.loading=false;this.error='';this.render();return;}
  if(key!==this.activeKey){this.activeKey=key;this.seq++;this.controller?.abort();this.loading=false;const c=this.cache.get(key);this.data=c?.data||null;this.fetched=c?.at||0;this.error='';this.retryAt=0;}
  this.render();if(this.loading||(!force&&this.data&&Date.now()-this.fetched<600000)||(!force&&Date.now()<this.retryAt))return;
  this.loading=true;const my=++this.seq,controller=this.controller=new AbortController();this.render();const timeout=setTimeout(()=>controller.abort(),12000);
  const params=new URLSearchParams({latitude:p.lat.toFixed(3),longitude:p.lon.toFixed(3),current:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',hourly:'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',forecast_days:'2',wind_speed_unit:'ms',timezone:'auto',timeformat:'unixtime'});
  try{const r=await fetch('https://api.open-meteo.com/v1/forecast?'+params,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('Weather service HTTP '+r.status);const j=await r.json();
   if(!j.current||!Number.isFinite(j.current.time)||!Number.isFinite(j.current.temperature_2m)||!Array.isArray(j.hourly?.time))throw Error('Weather data incomplete');
   if(my!==this.seq)return;this.data=j;this.fetched=Date.now();this.error='';this.cache.set(key,{data:j,at:this.fetched});if(this.cache.size>40)this.cache.delete(this.cache.keys().next().value);
  }catch(e){if(my!==this.seq)return;this.error=e.name==='AbortError'?'Weather request timed out':e.message;this.retryAt=Date.now()+60000;}
  finally{clearTimeout(timeout);if(my===this.seq){this.loading=false;this.render();}}
 }
 render(){const p=this.location,body=this.el.querySelector('.weather-body'),head=this.el.querySelector('strong');head.textContent='WEATHER · '+(this.data?this.temp(this.data.current.temperature_2m):this.loading?'LOADING':'FORECAST');
  if(!valid(p)){body.innerHTML='<p>Select a race profile with a route, or select a rider with a GPS fix, to load the forecast.</p>';return;}
  let h='<p><b>'+esc(p.name||'LOCATION')+'</b><br><span class="weather-meta">'+p.lat.toFixed(3)+', '+p.lon.toFixed(3)+(p.stale?' · RIDER GPS STALE':'')+'</span></p>';
  if(this.error)h+='<p class="weather-warn">'+esc(this.error)+(this.data?' · SHOWING CACHED DATA':' · NO WEATHER AVAILABLE')+'</p>';
  if(!this.data){body.innerHTML=h+'<p>'+(this.loading?'Loading model conditions…':'Waiting to retry. Use ↻ to refresh.')+'</p>';return;}
  const j=this.data,c=j.current,stale=Date.now()-this.fetched>900000||Date.now()-c.time*1000>5400000;
  const clock=t=>{try{return new Date(t*1000).toLocaleString([],{timeZone:j.timezone||'UTC',hour:'2-digit',minute:'2-digit',month:'short',day:'numeric'});}catch{return new Date(t*1000).toISOString();}};
  h=h.replace('</p>','<br><span class="weather-now">'+this.temp(c.temperature_2m)+' · '+label(c.weather_code)+'</span></p>');
  h+='<p>Feels '+this.temp(c.apparent_temperature)+' · Humidity '+this.num(c.relative_humidity_2m,'%')+'<br>Rain '+this.num(c.precipitation,' mm')+' · Wind '+this.speed(c.wind_speed_10m)+'<br>Gust '+this.speed(c.wind_gusts_10m)+' · From '+this.num(c.wind_direction_10m,'°')+'</p><p class="weather-meta">MODEL VALID '+esc(clock(c.time))+'<br>FETCHED '+new Date(this.fetched).toLocaleTimeString()+(stale?' · STALE':'')+'<br>'+esc(j.timezone||'UTC')+' · refresh every 10 minutes</p><div class="weather-hours"><div class="weather-hour"><b>LOCAL TIME</b><b>TEMP</b><b>RAIN CHANCE</b></div>';
  j.hourly.time.map((t,i)=>({t,i})).filter(o=>o.t>=Date.now()/1000).slice(0,6).forEach(({t,i})=>{h+='<div class="weather-hour"><span>'+esc(new Date(t*1000).toLocaleTimeString([],{timeZone:j.timezone||'UTC',hour:'2-digit',minute:'2-digit'}))+'</span><span>'+this.temp(j.hourly.temperature_2m?.[i])+'</span><span>'+this.num(j.hourly.precipitation_probability?.[i],'%')+'</span></div>';});
  h+='</div><p class="weather-meta weather-credit">Current model conditions + hourly forecast, not real-time observations. <a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data: Open-Meteo</a></p>';body.innerHTML=h;
 }
 num(v,u){return Number.isFinite(v)?Math.round(v)+u:'—';}
 temp(v){return Number.isFinite(v)?(UL.cfg?.v.units==='imperial'?Math.round(v*9/5+32)+'°F':Math.round(v)+'°C'):'—';}
 speed(v){return Number.isFinite(v)?(UL.cfg?.v.units==='imperial'?Math.round(v*2.23694)+' mph':Math.round(v*3.6)+' km/h'):'—';}
}
UL.WeatherWidget=WeatherWidget;
})();
