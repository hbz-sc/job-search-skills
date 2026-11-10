export class ExtensionJournal{
 constructor(storage){this.storage=storage;}
 async get(id){return (await this.storage.get('action:'+id))['action:'+id];}
 async put(id,value){await this.storage.set({['action:'+id]:value});}
}
