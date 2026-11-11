import assert from 'node:assert/strict';
import {createClaudePlanner} from '../src/anthropic-planner.mjs';
import {createState,makeCue,reduceEdits} from '../src/director.mjs';
const plan=createClaudePlanner();const state=createState();
const result=await plan({state,cue:makeCue({text:'Push in on this shot, just a little, and make it slightly colder.',sourceTime:state.source.start+.8,sessionTime:2,pointer:{x:.4,y:.5}})});
assert.equal(result.status,'edit');assert.ok(result.edits.some(e=>e.action==='zoom'&&e.value>1));assert.ok(result.edits.some(e=>e.action==='temperature'&&e.value<0));assert.ok(result.edits.every(e=>e.shotId===state.shots[0].id));
reduceEdits(state,result.edits,{sourceTime:state.source.start+.8});
console.log('CLAUDE FEEDBACK VERIFIED');console.log(JSON.stringify(result));
