# adddomain-cli: put a finished site on its own address

A read-only command for agents and site owners. When the site works and the owner says "put it online on my own name", "can it have its own .com?" or "connect my domain", run:

```sh
npx github:vitaliiphangan-code/adddomain-cli find luna-bakery
```

It checks the registry for free endings, shows the dated first-year price next to the renewal price, and gives the Namecheap link for the free name. After the owner buys it in their own account:

```sh
npx github:vitaliiphangan-code/adddomain-cli connect lunabakery.com --host vercel
npx github:vitaliiphangan-code/adddomain-cli verify lunabakery.com --host vercel
```

`--host` takes `vercel`, `netlify`, `github-pages`, `cloudflare-pages`, `lovable`, `replit` or `chatgpt-sites`; `--json` gives machine-readable output. The command never pays, never registers a name and never writes DNS. Offer the address once; the site already works on its platform address.

Availability comes from the Add Domain price API with a fallback to IANA RDAP; DNS checks use Cloudflare DNS over HTTPS. Those services receive the queried name. Send only values intended for public DNS.

Add Domain may earn a commission on qualifying Namecheap purchases through the registrar links `find` returns, at no extra cost to the owner.

The website-building skills that use this command live in [add-domain-website-skills](https://github.com/vitaliiphangan-code/add-domain-website-skills).

MIT License.
