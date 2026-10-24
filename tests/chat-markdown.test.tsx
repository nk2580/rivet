import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {ChatMarkdown} from '../src/components/ChatMarkdown';
describe('rendered assistant text',()=>{
  it('renders readable lists and local citations without raw HTML, remote images or executable links',()=>{
    const html=renderToStaticMarkup(<ChatMarkdown text={'1. **Move** up to your speed.\n2. Read [source](rivet://rules/5e-2024%3Arule%3Apage-13).\n\n<script>alert(1)</script>\n\n![tracking](https://example.test/tracker) [unsafe](javascript:alert%281%29)'}/>);
    expect(html).toContain('<ol>');expect(html).toContain('<strong>Move</strong>');expect(html).toContain('href="rivet://rules/5e-2024%3Arule%3Apage-13"');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).not.toContain('href="javascript:');
  });
});
