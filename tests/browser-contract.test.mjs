import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// User-facing layout requirements, independent of CSS implementation details.
test('keeps directions below the director camera and removes the sequence and idle prompt',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const preview=html.indexOf('id="stage"'),directions=html.indexOf('aria-label="Directions"'),camera=html.indexOf('class="director-deck"');
  assert.ok(preview<camera&&camera<directions);assert.doesNotMatch(html,/id="shots"|Ready for your direction|Point to a shot|Text-only fallback|id="direction-form"|Record take|id="undo"|id="original"|id="edited"|Physical directing|Shoty native engine|Trailer excerpt|<footer>/);
});
