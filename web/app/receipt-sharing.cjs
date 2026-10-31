function normalizePhone(value){
  const input=String(value??'').trim();if(!input||!/^[+\d\s().-]+$/.test(input)||input.includes('+')&&(!input.startsWith('+')||(input.match(/\+/g)||[]).length!==1))throw Error('Enter a valid WhatsApp phone number, including the country code for international numbers.');
  let phone=input.replace(/[^\d]/g,'');if(phone.startsWith('00'))phone=phone.slice(2);
  if(phone.length===8&&!input.startsWith('+')&&!input.startsWith('00'))phone='961'+phone.replace(/^0/,'');
  if(/^9610\d{7}$/.test(phone))phone='961'+phone.slice(4);
  if(!/^[1-9]\d{6,14}$/.test(phone))throw Error('Enter a valid WhatsApp phone number. Lebanese numbers can be entered locally; use a country code for other countries.');
  return phone;
}
const usd=value=>`$${Number(value||0).toFixed(2)}`;
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500);
function whatsappReceipt(kind,record,phone,section){
  const amount=Number(record.subtotal??record.amount),refund=amount<0,paid=Number(record.paidAmount??(record.paymentStatus==='unpaid'?0:amount));
  if(!Number.isFinite(amount))throw Error('Invalid receipt total.');
  const lines=['FIBER net lb',clean(section),`${refund?'Refund':'Receipt'}: ${clean(record.invoiceNo??record.receiptNo)}`,`Date: ${clean(record.createdAt??record.paidAt)}`,`Customer: ${clean(record.customerName||record.customerAccount||'Customer')}`];
  const account=record.customerAccount||record.customerPhone||record.phone;if(account)lines.push(`Account / phone: ${clean(account)}`);
  if(kind==='sale')for(const item of record.items||[])lines.push(`${clean(item.name)}${item.variantDescription?' · '+clean(item.variantDescription):''} × ${Number(item.quantity)}: ${usd(item.lineTotal)}`);
  else lines.push(`Service: ${clean(kind==='telecom'?[record.provider,record.itemName].filter(Boolean).join(' · '):kind==='installation'?'Installation payment':record.bundleName||record.serviceType)}`);
  if(record.billingPeriod)lines.push(`Billing month: ${clean(record.billingPeriod)}`);
  if(record.whishDestination)lines.push(`Whish destination: ${clean(record.whishDestination.label)} · ${clean(record.whishDestination.number)}`);
  lines.push(`${refund?'Refund amount':'Total'}: ${usd(Math.abs(amount))}`,`Payment: ${clean(record.paymentMethod)}`,`Status: ${clean(record.paymentStatus||'paid')}`,`${refund?'Refunded':'Paid'}: ${usd(Math.abs(paid))}`,`Balance due: ${usd(record.remainingAmount??Math.max(0,amount-paid))}`);
  if(record.renewal){lines.push(`Service renewal: ${clean(record.renewal.state)}`);if(record.renewal.afterExpiry)lines.push(`Expiry: ${clean(record.renewal.afterExpiry)}`);}
  if(record.renewal?.state==='free'){const funding=record.expenseFunding;lines.push('Internet service: free (expiry edit only)',`Expense funding received: ${usd(funding?.amount||0)} by ${clean(funding?.paymentMethod||record.paymentMethod)}`,`Funding receipt: ${clean(funding?.receiptNo||'No money received')}`,'Funding covers expenses; it is separate from Internet revenue.');if(funding?.whishDestination)lines.push(`Funding Whish destination: ${clean(funding.whishDestination.label)} · ${clean(funding.whishDestination.number)}`);}
  lines.push('Thank you for choosing FIBER net lb.');
  const message=lines.join('\n'),recipient=normalizePhone(phone);
  return {phone:recipient,message,url:`https://wa.me/${recipient}?text=${encodeURIComponent(message)}`};
}
function validateWhatsAppUrl(value){
  if(typeof value!=='string'||value.length>30000)throw Error('Invalid WhatsApp link.');
  let url;try{url=new URL(value);}catch{throw Error('Invalid WhatsApp link.');}
  if(url.protocol!=='https:'||url.hostname!=='wa.me'||url.port||url.username||url.password||url.hash||!/^\/[1-9]\d{6,14}$/.test(url.pathname)||[...url.searchParams.keys()].some(k=>k!=='text')||url.searchParams.getAll('text').length!==1)throw Error('Only a prepared WhatsApp receipt link can be opened.');
  return url.href;
}
module.exports={normalizePhone,whatsappReceipt,validateWhatsAppUrl};
