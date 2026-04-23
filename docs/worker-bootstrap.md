# Worker bootstrap

`cubolab worker bootstrap/teardown` gerencia o trust bundle do cubolab em
workers remotos via SSH — instala o cert CA no trust store do sistema e expõe
a var `CUBOLAB_TRUST=/etc/cubolab/trust.pem` em `/etc/environment`, que
consumidores (Caddy, outros ACME clients) usam como `acme_ca_root` ou equivalente.

## Uso

```bash
cubolab worker bootstrap <ssh-target> [--identity <key>] [--port <N>]
cubolab worker teardown  <ssh-target> [--identity <key>] [--port <N>]
```

## Pré-requisitos

- **SSH como user root ou sudo NOPASSWD** no `<ssh-target>`. `update-ca-trust`
  / `update-ca-certificates` escrevem em `/etc/pki/` ou `/etc/ssl/`, que
  requerem privilégio.
- **Distro suportada**: Fedora/RHEL/CentOS (via `update-ca-trust`) ou
  Debian/Ubuntu/Alpine (via `update-ca-certificates`). Outras distros
  retornam erro claro com ponteiro pra este doc.
- `ssh`, `scp`, `sha256sum` disponíveis no PATH local (todos presentes em
  qualquer dev host Linux).

## Example — worker Vagrant do PodCubo

```bash
cubolab worker bootstrap root@localhost \
    --port 2231 \
    --identity ~/.ssh/podcubo_key
```

Output esperado:

```
cubolab worker bootstrap root@localhost

  distro:         fedora
  anchor:         /etc/pki/ca-trust/source/anchors/cubolab.pem
  bundle:         uploaded (sha256: 3a7b12f9ec40...)
  env var:        added (/etc/environment)

Worker ready. CUBOLAB_TRUST=/etc/cubolab/trust.pem
```

## Idempotência

- **Bundle upload**: hash SHA256 do trust bundle local é comparado com o
  remoto antes do `scp`. Se iguais, skip upload. Segundo run da
  mesma máquina com mesmo bundle: `bundle: reused (hash match)`.
- **Env var**: `grep -q "^CUBOLAB_TRUST=" /etc/environment` antes do append.
  Segundo run: `env var: already present`.
- **Teardown em target nunca-bootstrapped**: `rm -f` ignora ausência,
  `rmdir` com `|| true`, `sed` no-op se linha ausente. Retorna sem erro.

## Dispatcher por distro

| Distro | Anchor path | Update command |
|---|---|---|
| Fedora, RHEL, CentOS | `/etc/pki/ca-trust/source/anchors/cubolab.pem` | `update-ca-trust` |
| Debian, Ubuntu, Alpine | `/usr/local/share/ca-certificates/cubolab.crt` | `update-ca-certificates` |

Detectado via parse do `/etc/os-release` (campo `ID=`) no target. Alpine
stripped sem `/etc/os-release` retorna erro claro ("target may be minimal
image without os-release file").

## O que fica no target depois do bootstrap

```
/etc/pki/ca-trust/source/anchors/cubolab.pem   # Fedora: o cert
/usr/local/share/ca-certificates/cubolab.crt   # ou Debian-family: o cert
/etc/cubolab/trust.pem                         # symlink pro anchor (contrato público)
/etc/environment: CUBOLAB_TRUST=/etc/cubolab/trust.pem
```

## Teardown

```bash
cubolab worker teardown root@localhost --port 2231 --identity ~/.ssh/podcubo_key
```

Remove tudo acima. `rmdir /etc/cubolab` usa `|| true` pra preservar
arquivos extras que alguém possa ter colocado no dir (paranoia; `rm -rf`
seria mais agressivo sem necessidade).

## Troubleshooting

**`ssh: Permission denied (publickey)`**: a chave passada não está autorizada
no `authorized_keys` do user remoto, ou o user não aceita a chave. Reveja
`~/.ssh/config` do target ou passe `--identity` explícito.

**`couldn't read /etc/os-release`**: target não tem esse arquivo. Alpine
stripped sem `alpine-release` também não cobre. Workaround manual: copiar
o cert e rodar `update-ca-certificates` você mesmo via SSH.

**`sudo: sorry, you must have a tty to run sudo`**: SSH não provê TTY por
default. Se o user não é root direto, configure `NOPASSWD` pro
`update-ca-trust` / `update-ca-certificates` em `/etc/sudoers.d/cubolab`,
ou conecte como root direto.

## Integration test automated

**Fora do escopo de M4**. Este doc serve como integration test manual.
M5+ pode adicionar CI step com QEMU/Docker-in-Docker rodando Fedora
minimal + Alpine minimal + Ubuntu containers com sshd.
