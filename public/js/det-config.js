var DET_SEMANAS = [
  {id:'S40',label:'Sem 40',eqac:8.4,pl:26.1,np:7.7,rep:3.2,parque:5},
  {id:'S41',label:'Sem 41',eqac:5.8,pl:23.4,np:7.9,rep:16.1,parque:4},
  {id:'S42',label:'Sem 42',eqac:1.2,pl:38.3,np:10.0,rep:7.8,parque:4},
  {id:'S43',label:'Sem 43',eqac:3.2,pl:12.0,np:12.5,rep:12.1,parque:6},
];

var DET_WATERFALL = {
  S40:[{cat:'Falta Rep.',val:3.2,t:'rep'},{cat:'Mant. PL',val:26.1,t:'pl'},{cat:'Mant. NP',val:7.7,t:'np'},{cat:'EQAC',val:8.4,t:'eqac'}],
  S41:[{cat:'Falta Rep.',val:16.1,t:'rep'},{cat:'Mant. PL',val:23.4,t:'pl'},{cat:'Mant. NP',val:7.9,t:'np'},{cat:'EQAC',val:5.8,t:'eqac'}],
  S42:[{cat:'Falta Rep.',val:7.8,t:'rep'},{cat:'Mant. PL',val:38.3,t:'pl'},{cat:'Mant. NP',val:10.0,t:'np'},{cat:'EQAC',val:1.2,t:'eqac'}],
  S43:[{cat:'Falta Rep.',val:12.1,t:'rep'},{cat:'Mant. PL',val:12.0,t:'pl'},{cat:'Backlog',val:2.0,t:'pl'},{cat:'NP Eléct.',val:5.8,t:'np'},{cat:'NP Perf.',val:3.7,t:'np'},{cat:'NP Hidr.',val:3.0,t:'np'},{cat:'EQAC',val:3.2,t:'eqac'}],
};

var DET_EQUIPOS = {
  S40:[{id:'JR001',disp:82,f:3,mttr:28},{id:'JR002',disp:78,f:4,mttr:22},{id:'JR003',disp:55,f:2,mttr:65},{id:'JR004',disp:75,f:3,mttr:20},{id:'JR005',disp:72,f:5,mttr:18},{id:'JR006',disp:48,f:4,mttr:52},{id:'JR007',disp:70,f:2,mttr:30},{id:'JR008',disp:80,f:2,mttr:15},{id:'JR009',disp:66,f:6,mttr:12},{id:'JR010',disp:88,f:1,mttr:10}],
  S41:[{id:'JR001',disp:85,f:2,mttr:20},{id:'JR002',disp:62,f:6,mttr:28},{id:'JR003',disp:30,f:2,mttr:100},{id:'JR004',disp:68,f:4,mttr:30},{id:'JR005',disp:60,f:5,mttr:35},{id:'JR006',disp:22,f:3,mttr:88},{id:'JR007',disp:74,f:2,mttr:22},{id:'JR008',disp:76,f:3,mttr:18},{id:'JR009',disp:64,f:5,mttr:15},{id:'JR010',disp:82,f:2,mttr:12}],
  S42:[{id:'JR001',disp:80,f:3,mttr:22},{id:'JR002',disp:58,f:7,mttr:26},{id:'JR003',disp:15,f:2,mttr:130},{id:'JR004',disp:65,f:4,mttr:32},{id:'JR005',disp:55,f:6,mttr:40},{id:'JR006',disp:18,f:3,mttr:92},{id:'JR007',disp:70,f:3,mttr:24},{id:'JR008',disp:72,f:3,mttr:20},{id:'JR009',disp:62,f:5,mttr:18},{id:'JR010',disp:80,f:2,mttr:14}],
  S43:[{id:'JR001',disp:87,f:2,mttr:8},{id:'JR002',disp:72,f:5,mttr:22},{id:'JR003',disp:0,f:1,mttr:168},{id:'JR004',disp:70,f:3,mttr:28},{id:'JR005',disp:64,f:4,mttr:36},{id:'JR006',disp:7,f:3,mttr:90},{id:'JR007',disp:73,f:2,mttr:25},{id:'JR008',disp:73,f:3,mttr:15},{id:'JR009',disp:69,f:4,mttr:18},{id:'JR010',disp:85,f:1,mttr:12}],
};

var DET_NP = [
  {s:'Eléctrico',indisp:4.5,f:3,hrs:81,badge:'be',comps:['Sensor inclinación JR004/JR009/JR002','Cable alimentación EX','Profundímetro','Sensor R243/S13']},
  {s:'Perforación',indisp:4.1,f:3,hrs:64,badge:'bp',comps:['Cil. avance perforadora JR009','Mordazas','Acumulador']},
  {s:'Hidráulico',indisp:2.6,f:13,hrs:47,badge:'bh',comps:['Flexibles JR002/JR005/JR008']},
  {s:'Aire Acond.',indisp:1.3,f:2,hrs:21,badge:'ba',comps:['Compresor','Ductos']},
];

var DET_TCOL = {rep:'#06b6d4',pl:'#f59e0b',np:'#0f766e',eqac:'#dc2626'};

function detMedian(arr) {
  var s = arr.slice().sort(function(a,b){return a-b;});
  var m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : +((s[m-1]+s[m])/2).toFixed(1);
}
