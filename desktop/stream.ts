/** SSE frames can cross arbitrary HTTP chunks and contain multiline data. */
export async function* responseEvents(body:ReadableStream<Uint8Array>){
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
  try{for(;;){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let boundary:number;
    while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]')yield JSON.parse(data);}
    if(done){if(buffer.trim()){const data=buffer.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]')yield JSON.parse(data);}break;}
  }}finally{reader.releaseLock();}
}
