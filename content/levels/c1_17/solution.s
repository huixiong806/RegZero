# 从 0xF0000004 读字符流，仅将小写字母 a-z 转为大写，输出到 0xF0000000
li   t0, 0xF0000000
li   t1, 0xF0000004
addi t3, zero, 97
addi t4, zero, 123
loop:
lbu  t2, 0(t1)
beq  t2, zero, done
blt  t2, t3, emit
bge  t2, t4, emit
addi t2, t2, -32
emit:
sb   t2, 0(t0)
j    loop
done:
ecall
