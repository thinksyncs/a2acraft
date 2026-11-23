import {ui} from './interface-language.js';
// The settlement keeps its original scale inside a larger, explorable world.
// Landmarks and their entrances are shared by painting and navigation.
export const VILLAGE_WORLD=Object.freeze({
 left:-900,right:1900,top:-900,bottom:1150,
 home:Object.freeze({x:500,y:320}),
 core:Object.freeze({width:1000,height:640})
});

export const VILLAGE_PLACES=Object.freeze([
 Object.freeze({id:'tavern',name:ui('旅立ちの酒場', "Wayfarers' Tavern"),shortName:ui('酒場', "Tavern"),x:-420,y:340,entrance:Object.freeze({x:-420,y:400})}),
 Object.freeze({id:'castle',name:ui('王城', "Royal castle"),shortName:ui('お城', "Castle"),x:1430,y:340,entrance:Object.freeze({x:1430,y:400})}),
 Object.freeze({id:'weapon',name:ui('スキルの武器屋', "Skill shop"),shortName:ui('武器屋', "Weapon shop"),x:500,y:-160,entrance:Object.freeze({x:500,y:-90})})
]);
