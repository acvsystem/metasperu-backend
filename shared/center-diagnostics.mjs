export function reportCenterError(event,error,requestId) {
  const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.code)?error.code:'UNEXPECTED';
  console.error(JSON.stringify({event,code,...(requestId?{requestId}:{})}));
}
