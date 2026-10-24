import Markdown from 'react-markdown';

export function chatLink(value:string){
  try{const url=new URL(value);if(url.protocol==='https:')return url.href;if(url.protocol==='rivet:'&&url.hostname==='rules'&&/^(?:5e-2014|5e-2024|3\.5e):[a-z-]+:[a-z0-9.-]+$/i.test(decodeURIComponent(url.pathname.slice(1))))return url.href;}catch{}
  return '';
}
export function ChatMarkdown({text}:{text:string}){
  return <div className="chat-markdown"><Markdown skipHtml allowedElements={['p','a','em','strong','ul','ol','li','blockquote','code','pre','br','hr','h1','h2','h3','h4','h5','h6']} urlTransform={(url,key,node)=>key==='href'&&node.tagName==='a'?chatLink(url):''} components={{a:({node,...props})=><a {...props} target="_blank" rel="noreferrer"/>,h1:'h3',h2:'h3'}}>{text}</Markdown></div>;
}
