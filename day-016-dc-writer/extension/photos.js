import {MAX_PHOTOS,MAX_BYTES} from './core.js';
const TYPES=new Set(['image/png','image/jpeg','image/webp','image/gif','image/bmp']);
let database;
function db(){return database ||= new Promise((resolve,reject)=>{const r=indexedDB.open('dc-writer-draft',1);r.onupgradeneeded=()=>r.result.createObjectStore('draft');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('기기 저장소를 열지 못했습니다.'));});}
export async function draftStorage(method,value){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('draft',method==='get'?'readonly':'readwrite'),store=tx.objectStore('draft');const r=method==='get'?store.get('current'):method==='clear'?store.delete('current'):store.put(value,'current');let result;r.onsuccess=()=>{result=r.result};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(Error('기기에 초안을 저장하지 못했습니다. 저장 공간을 확인해 주세요.'));tx.onabort=tx.onerror;});}
export async function preparePhoto(file,compress=true){
  if (!TYPES.has(file.type) || !file.size || file.size>MAX_BYTES) throw Error('PNG, JPG, WebP, GIF, BMP 사진을 20MB 이하로 넣어 주세요.');
  let blob=file;
  const image=await createImageBitmap(file).catch(()=>{throw Error('이미지 파일을 읽지 못했습니다.');});
  try {
    if (!image.width || !image.height || image.width*image.height>40_000_000) throw Error('이미지 해상도가 너무 큽니다. 4,000만 화소 이하로 넣어 주세요.');
    if (compress && ['image/png','image/jpeg'].includes(file.type)) {
      const ratio=Math.min(1,1600/Math.max(image.width,image.height));const canvas=new OffscreenCanvas(Math.round(image.width*ratio),Math.round(image.height*ratio));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const webp=await canvas.convertToBlob({type:'image/webp',quality:.88});
      if (webp.size<file.size || ratio<1) blob=webp;
    }
  } finally {image.close();}
  return {id:crypto.randomUUID(),name:file.name,blob,type:blob.type,size:blob.size,caption:''};
}
export function assertPhotoCount(current,adding){if (current+adding>MAX_PHOTOS) throw Error(`사진은 최대 ${MAX_PHOTOS}장까지 넣을 수 있습니다.`);}
export async function base64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('사진을 읽지 못했습니다.'));r.readAsDataURL(blob);});}
export async function analysisImage(blob){const bitmap=await createImageBitmap(blob);try{const r=Math.min(1,768/Math.max(bitmap.width,bitmap.height));const canvas=new OffscreenCanvas(Math.round(bitmap.width*r),Math.round(bitmap.height*r));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const b=await canvas.convertToBlob({type:'image/jpeg',quality:.7});return `data:image/jpeg;base64,${await base64(b)}`;}finally{bitmap.close();}}
