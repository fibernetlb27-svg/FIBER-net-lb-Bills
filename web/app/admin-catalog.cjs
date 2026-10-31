'use strict';
// Consolidated Admin view only: every fixed action stays in its original business.
// No shared inventory, arbitrary RPC dispatch, journal or automatic sale retry.
const PRODUCT_FIELDS=['name','sku','category','currency','cost','markup','price','quantity','reorderLevel','printPriceTable','barcodes','barcode','additionalBarcodes','printColorPrice','printSinglePrice','printDoublePrice','printDuplexExtra','printNoBindingPrice','printBindingPrice','printBindingExtra','printPlainPrice','printCansonPrice','printCansonExtra','printStickerPrice','printStickerExtra'];
const PRINT_SERVICES=['bw','color','doubleBw','doubleColor','boundColor','boundBw','canson','sticker'];
function object(value,allowed,required=[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Choose valid catalog details.');
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key)))throw Error('Unsupported catalog field. Refresh the form and try again.');
  if(required.some(key=>!Object.hasOwn(value,key)))throw Error('Required catalog details are missing.');
  return value;
}
function identifier(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Choose a valid source product or receipt.');return value;}
function text(value,label,max=5000){if(typeof value!=='string'||value.length>max||value.includes('\0'))throw Error('Enter valid '+label+'.');return value;}
function scalar(value){if(typeof value==='string')return text(value,'product value');if(typeof value==='number'&&Number.isFinite(value))return value;throw Error('Product values must be text or finite numbers.');}
function priceTable(value){
  object(value,['A4','A5','A3','custom']);const result={};
  for(const size of ['A4','A5','A3'])if(value[size]!==undefined){object(value[size],PRINT_SERVICES);result[size]=Object.fromEntries(Object.entries(value[size]).filter(([,price])=>price!==undefined).map(([key,price])=>[key,scalar(price)]));}
  if(value.custom!==undefined){
    if(!Array.isArray(value.custom)||value.custom.length>50)throw Error('Choose valid custom printing prices.');
    result.custom=value.custom.map(item=>{object(item,['key','name','price'],['key','name','price']);return {key:text(item.key,'printing key',80),name:text(item.name,'printing name',80),price:scalar(item.price)};});
  }
  return result;
}
function productInput(value){
  object(value,PRODUCT_FIELDS);const result={};
  for(const [key,valuePart]of Object.entries(value)){
    if(valuePart===undefined)continue;
    if(key==='printPriceTable'){result[key]=priceTable(valuePart);continue;}
    if(key==='barcodes'){if(!Array.isArray(valuePart)||valuePart.length>100)throw Error('Choose valid product barcodes.');result[key]=valuePart.map(code=>text(code,'barcode',100));continue;}
    result[key]=scalar(valuePart);
  }
  return result;
}
function printingOptions(value){
  object(value,['size','service','costKnown']);const result={};
  if(value.size!==undefined)result.size=text(value.size,'printing size',120);
  if(value.service!==undefined)result.service=text(value.service,'printing service',80);
  if(value.costKnown!==undefined){if(typeof value.costKnown!=='boolean')throw Error('Choose valid printing options.');result.costKnown=value.costKnown;}
  return result;
}
function createAdminCatalog({workspaces,authorize,delegate}){
  const sections=workspaces.map(({id,name,kind})=>Object.freeze({id,name,kind})),byId=new Map(sections.map(section=>[section.id,section]));
  function section(value){if(typeof value!=='string'||!byId.has(value))throw Error('Choose a valid source business.');return byId.get(value);}
  const tag=(value,source)=>({...value,workspaceId:source.id,workspaceName:source.name,workspaceKind:source.kind});
  const product=(value,source)=>{if(!value||!Number.isSafeInteger(value.id)||value.id<1)throw Error('The source product could not be verified.');return {...tag(value,source),catalogKey:`${source.id}:${value.id}`};};
  const receipt=(value,source)=>{if(!value||!Number.isSafeInteger(value.id)||value.id<1)throw Error('The source receipt could not be verified. Check source history before retrying.');return {...tag(value,source),receiptKey:`${source.id}:sale:${value.id}`};};
  function call(authority,source,channel,args,checkout=false){return delegate(authority,source.id,channel,args,{checkout});}
  return {
    list(){
      const authority=authorize(),products=[];
      for(const source of sections){const rows=call(authority,source,'products:list',[]);if(!Array.isArray(rows))throw Error('The source catalog could not be verified.');products.push(...rows.map(row=>product(row,source)));}
      return {workspaces:sections.map(value=>({...value})),products};
    },
    generateBarcode(workspaceId){const authority=authorize(),source=section(workspaceId);return call(authority,source,'barcodes:generate',[]);},
    create(value){const authority=authorize();object(value,['workspaceId','product'],['workspaceId','product']);const source=section(value.workspaceId),input=productInput(value.product);return product(call(authority,source,'products:create',[input]),source);},
    update(value){const authority=authorize();object(value,['workspaceId','productId','product'],['workspaceId','productId','product']);const source=section(value.workspaceId),id=identifier(value.productId),input=productInput(value.product);return product(call(authority,source,'products:update',[id,input]),source);},
    remove(value){const authority=authorize();object(value,['workspaceId','productId'],['workspaceId','productId']);const source=section(value.workspaceId),id=identifier(value.productId);return tag(call(authority,source,'products:delete',[id]),source);},
    sell(value){
      const authority=authorize();object(value,['workspaceId','items','expectedSubtotal','paymentMethod','whishDestinationId','customerName','customerPhone','customerAccount'],['workspaceId','items','expectedSubtotal','paymentMethod']);
      const source=section(value.workspaceId);if(!Array.isArray(value.items)||!value.items.length||value.items.length>500)throw Error('Add products from one source business before checkout.');
      const quantities=new Map(),items=value.items.map(item=>{
        object(item,['workspaceId','productId','quantity','printingOptions'],['workspaceId','productId','quantity']);
        if(item.workspaceId!==source.id)throw Error('A checkout can contain products from one source business only.');
        const productId=identifier(item.productId),quantity=identifier(item.quantity),count=(quantities.get(productId)||0)+quantity;
        if(!Number.isSafeInteger(count))throw Error('Sale quantity is too large.');quantities.set(productId,count);
        return {productId,quantity,...item.printingOptions!==undefined?{printingOptions:printingOptions(item.printingOptions)}:{}};
      });
      const expected=value.expectedSubtotal,expectedText=['number','string'].includes(typeof expected)?String(expected).trim():'';
      if(!/^\d+(?:\.\d{1,2})?$/.test(expectedText)||!Number.isFinite(Number(expectedText))||!Number.isSafeInteger(Math.round(Number(expectedText)*100)))throw Error('Review an expected sale total in exact cents.');
      if(!['Cash','Whish Money','Unpaid'].includes(value.paymentMethod))throw Error('Choose Cash, Whish Money or Unpaid.');
      const input={items,expectedSubtotal:Number(expectedText),paymentMethod:value.paymentMethod};
      for(const field of ['customerName','customerPhone','customerAccount'])if(value[field]!==undefined)input[field]=text(value[field],field);
      if(value.whishDestinationId!==undefined)input.whishDestinationId=text(value.whishDestinationId,'Whish destination',300);
      return receipt(call(authority,source,'sales:create',[input],true),source);
    },
    receipt(value){const authority=authorize();object(value,['workspaceId','saleId'],['workspaceId','saleId']);const source=section(value.workspaceId),id=identifier(value.saleId);return receipt(call(authority,source,'sales:receipt',[id]),source);},
    whatsapp(value){const authority=authorize();object(value,['workspaceId','saleId','phone'],['workspaceId','saleId','phone']);const source=section(value.workspaceId),id=identifier(value.saleId),phone=text(value.phone,'WhatsApp phone',200);return {...tag(call(authority,source,'receipts:whatsapp',[{kind:'sale',id,phone}]),source),saleId:id};}
  };
}
module.exports={createAdminCatalog,productInput,printingOptions};
