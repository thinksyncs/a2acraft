import {worldText} from './i18n-world.js';
// The settlement keeps its original scale inside a larger, explorable world.
// Landmarks and their entrances are shared by painting and navigation.
export const VILLAGE_WORLD=Object.freeze({
 left:-900,right:1900,top:-900,bottom:1150,
 home:Object.freeze({x:500,y:320}),
 core:Object.freeze({width:1000,height:640})
});

export const VILLAGE_PLACES=Object.freeze([
 Object.freeze({id:'tavern',get name(){return worldText('旅立ちの酒場');},shortLabel:'酒場',get shortName(){return worldText(this.shortLabel);},x:-420,y:340,entrance:Object.freeze({x:-420,y:400})}),
 Object.freeze({id:'castle',get name(){return worldText('王城');},shortLabel:'お城',get shortName(){return worldText(this.shortLabel);},x:1430,y:340,entrance:Object.freeze({x:1430,y:400})}),
 Object.freeze({id:'weapon',get name(){return worldText('スキルの武器屋');},shortLabel:'武器屋',get shortName(){return worldText(this.shortLabel);},x:500,y:-160,entrance:Object.freeze({x:500,y:-90})})
]);
