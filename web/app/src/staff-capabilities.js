(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StaffCapabilities=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Existing cashier capabilities only. Administrative privileges are never configurable here.
  const catalog=Object.freeze([
    ['products.manage','Add and edit non-stock services','Original business service prices and barcodes; no Admin stock editing or deletion.'],
    ['sales.create','Point of Sale','Sell products and print sale receipts.'],
    ['bills.create','Renew and record bills','Customer and reseller bill payments.'],
    ['resellerFunding.manage','Reseller Add Money and Refund','Cashier/Support only; own drawer, wallets and original payments.'],
    ['customers.manage','Create Internet customers','Create Proradius customers and their first payments.'],
    ['plans.manage','Change Internet plans','Quote and confirm customer service changes.'],
    ['telecom.create','Mobile & Ogero payments','Record recharge cards, airtime, validity and bills.'],
    ['debts.manage','Collect debts','Record partial or full customer debt payments.'],
    ['drawer.manage','Cash drawer actions','Count cash and perform permitted money movements.'],
    ['reports.view','View own reports','Own activity only, in assigned businesses.'],
    ['attendance.clock','Scan attendance cards','Clock in and out; no employee editing.']
  ].map(([permission,label,description])=>Object.freeze({permission,label,description})));
  const keys=new Set(catalog.map(item=>item.permission));
  function normalize(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Cashier feature permissions must be an object.');
    const result={};
    for(const key of Object.keys(value)){
      if(!keys.has(key))throw new Error('This feature cannot be assigned to a cashier.');
      if(typeof value[key]!=='boolean')throw new Error('Feature permissions must be true or false.');
      result[key]=value[key];
    }
    return result;
  }
  function apply(permissions,settings={}){
    const safe=normalize(settings);
    // Overrides can restrict baseline abilities, never add a new privilege.
    return permissions.filter(permission=>!keys.has(permission)||safe[permission]!==false);
  }
  function defaults(){return Object.fromEntries(catalog.map(item=>[item.permission,true]));}
  function effective(settings={}){return {...defaults(),...normalize(settings)};}
  return {catalog,normalize,apply,defaults,effective};
});
