const {lateRenewalPolicy}=require('./src/internet-pricing.js');
function freeRenewalInput(value,now=new Date()) {
  const policy=lateRenewalPolicy(now);
  if(!policy.free)throw Error('Free renewal is available only from the 11th through the 4th. Refresh the form for a normal paid renewal.');
  if(value?.confirm!==true||value.policy!==policy.policy||value.asOf!==policy.asOf||value.expiry!==policy.expiry)throw Error('Refresh the renewal date and confirm the free service and expense funding. Nothing was submitted.');
  const text=(key,max)=>{const s=String(value[key]??'').trim();if(s.length>max||/[\u0000-\u001f]/.test(s))throw Error(`Invalid ${key}.`);return s;};
  const username=text('username',128),requestId=text('requestId',100),expectedExpiry=text('expectedExpiry',100),reference=text('reference',500);
  if(!/^[A-Za-z0-9._@+-]{3,128}$/.test(username)||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw Error('Verify the customer and use a valid renewal request ID.');
  const serviceId=Number(value.serviceId),resellerId=Number(value.resellerId);
  if(!Number.isSafeInteger(serviceId)||serviceId<=0||!Number.isSafeInteger(resellerId)||resellerId<=0||!expectedExpiry)throw Error('Verify the current customer, owner, service and expiry before free renewal.');
  const amount=Number(value.amount),paymentMethod=value.paymentMethod;
  if(value.amount===''||value.amount===null||value.amount===undefined||!Number.isFinite(amount)||amount<0||amount>1000000||Math.abs(Math.round(amount*100)/100-amount)>0.000001)throw Error('Expense funding must be zero or a positive USD amount with two decimals.');
  if(!['Cash','Whish Money'].includes(paymentMethod))throw Error('Received expense funding must be Cash or Whish Money, not an unpaid Internet debt.');
  return {requestId,username,serviceId,resellerId,expectedExpiry,reference,amount:Math.round(amount*100)/100,paymentMethod,policy:policy.policy,asOf:policy.asOf,expiry:policy.expiry};
}
module.exports={freeRenewalInput};
