export interface WarehouseDirectory {
 branch(id:string,name:string):void;
 warehouse(id:string,branch:string,name:string):void;
 location(id:string,warehouse:string,name:string):void;
 directory():Record<string,string>[];
 places():Record<string,string>[];
}
