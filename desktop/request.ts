/** Retry an unreceived response, never an already executed tool or completed agent round. */
export async function fetchGuideResponse(url:string,options:RequestInit):Promise<Response>{
  const delays=[300,900];
  for(let attempt=0;;attempt++){
    try{
      const response=await fetch(url,options);
      if(![502,503,504].includes(response.status)||attempt>=delays.length)return response;
      await response.body?.cancel();
    }catch(error){
      if(options.signal?.aborted||!(error instanceof TypeError)||attempt>=delays.length)throw error;
    }
    await new Promise<void>((resolve,reject)=>{
      const signal=options.signal;
      const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason??new Error('Stopped.'));};
      const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delays[attempt]);
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
    });
  }
}
