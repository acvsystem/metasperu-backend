"""Prepare reviewable DEV copies without importing or running legacy agents."""
import argparse
import ast
import hashlib
import json
import re
import shutil
from pathlib import Path

CENTER_AGENTS = (
    'centerService.py', 'centerInventario.py', 'centerAccounting.py',
    'serverResoucesHumanEJB.py', 'serverResourcesHuman.py', 'agenteServidor.py',
)
PASSWORD = re.compile(r'\b(PWD|PASSWORD|UID|USER ID)\s*=\s*(?:\{(?:\}\}|[^}])*\}|[^;]*)', re.I)


class DevAdapter(ast.NodeTransformer):
    def __init__(self, filename):
        self.filename = filename
        self.slots = []

    def visit_Constant(self, node):
        if isinstance(node.value, str):
            return ast.copy_location(ast.Constant(PASSWORD.sub(r'\1=[CONFIGURACION_EXTERNA]', node.value)), node)
        return node

    def visit_FunctionDef(self, node):
        # Guards execute before Socket.IO registers the callback.
        node = self.generic_visit(node)
        guards = []
        for decorator in node.decorator_list:
            if (isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute)
                    and decorator.func.attr == 'on' and decorator.args):
                guards.append(ast.Call(ast.Name('dev_handler', ast.Load()), [decorator.args[0]], []))
        node.decorator_list.extend(guards)
        return node

    def visit_Call(self, node):
        node = self.generic_visit(node)
        if not isinstance(node.func, ast.Attribute):
            return node
        receiver = ast.unparse(node.func.value)
        if receiver == 'pyodbc' and node.func.attr == 'connect':
            if len(node.args) != 1:
                raise ValueError('Conexion SQL no reconocida: requiere revision manual.')
            slot = f'{self.filename}:{node.lineno}'
            self.slots.append(slot)
            node.func = ast.Name('dev_sql_connect', ast.Load())
            node.args.insert(0, ast.Constant(slot))
        elif receiver == 'sio' and node.func.attr == 'connect':
            node.func = ast.Name('dev_connect', ast.Load())
            node.args.insert(0, ast.Name('sio', ast.Load()))
        elif receiver == 'requests' and node.func.attr == 'post':
            node.func = ast.Name('agent_post', ast.Load())
        elif receiver == 'sio' and node.func.attr == 'on' and node.args:
            wrapper = ast.Call(ast.Name('dev_handler', ast.Load()), [node.args[0]], [])
            if len(node.args) > 1:
                node.args[1] = ast.Call(wrapper, [node.args[1]], [])
            for keyword in node.keywords:
                if keyword.arg == 'handler':
                    keyword.value = ast.Call(wrapper, [keyword.value], [])
        return node


def adapt_source(source, filename):
    if filename not in CENTER_AGENTS:
        raise ValueError('Este agente no pertenece al protocolo Center revisado.')
    tree = ast.parse(source)
    adapter = DevAdapter(filename)
    tree = adapter.visit(tree)
    imports = ast.parse('from center_agent_dev import dev_connect, dev_sql_connect, dev_handler, require_dev\n'
                        'from center_agent_dev import dev_post as agent_post\nrequire_dev()\n').body
    # Preserve module docstrings and future imports.
    index = 0
    while index < len(tree.body) and (isinstance(tree.body[index], ast.ImportFrom)
            and tree.body[index].module == '__future__' or index == 0
            and isinstance(tree.body[index], ast.Expr) and isinstance(tree.body[index].value, ast.Constant)
            and isinstance(tree.body[index].value.value, str)):
        index += 1
    tree.body[index:index] = imports
    result = '# COPIA DEV: no sustituir el agente de produccion.\n' + ast.unparse(ast.fix_missing_locations(tree)) + '\n'
    compile(result, filename, 'exec')
    return result, adapter.slots


def prepare(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists():
        raise FileExistsError('El destino ya existe; no se sobrescriben agentes preparados.')
    # Validate everything before creating output; never import user modules.
    prepared = []
    for filename in CENTER_AGENTS:
        raw = (source / filename).read_bytes()
        adapted, slots = adapt_source(raw.decode('utf-8-sig'), filename)
        prepared.append((filename, adapted, slots, hashlib.sha256(raw).hexdigest()))
    output.mkdir(parents=True)
    for filename, adapted, _, _ in prepared:
        (output / filename).write_text(adapted, encoding='utf-8')
    service = Path(__file__).resolve().parents[1]
    for filename in ('center_agent_auth.py', 'center_agent_dev.py'):
        shutil.copyfile(service / filename, output / filename)
    manifest = [{'file': name, 'original_sha256': digest, 'sql_slots': slots}
                for name, _, slots, digest in prepared]
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    example = {slot: {'BASE_ORIGEN': ''} for _, _, slots, _ in prepared for slot in slots}
    (output / 'sql-connections.example.json').write_text(json.dumps(example, indent=2), encoding='utf-8')
    shutil.copyfile(service / 'docs' / 'AGENTS-DEV.md', output / 'LEEME.md')
    (output / '.gitignore').write_text('*.token\n.private/\nsql-connections.json\n__pycache__/\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    arguments = parser.parse_args()
    manifest = prepare(arguments.source, arguments.output)
    print(f'{len(manifest)} agentes preparados sin ejecutar ni modificar los originales.')
