import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStockLookup} from '../../shared/center-stock-input.mjs';
test('stock lookups reject code injection and unbounded quantities before reaching Python agents',()=>{
  for(const [barcode,qty,allowed] of [['000001',1,true],['AB.01-X',2,true],["x' OR 1=1",1,false],['A',Infinity,false],['A',-1,false],['A',1000001,false]]){
    let passed=false,status;const res={status(n){status=n;return this;},json(){}};
    validateStockLookup({path:'/api/inventory/one/search',body:{dataCode:[{codigo_barra:barcode,cantidad_solicitada:qty}]}},res,()=>passed=true);
    assert.equal(passed,allowed);if(!allowed)assert.equal(status,422);
  }
});
