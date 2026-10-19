const store=global.__COLS||(global.__COLS=new Set());
exports.collections={listDataCollections:async()=>({collections:[...store].map(id=>({_id:id}))}),createDataCollection:async(c)=>{store.add(c._id||c.id||(c.collection&&c.collection._id));return c}};
