# 读入 n 与 n 个整数，输出「总和 最大值」，最后用 a7=0 的 ecall 退出
addi a7, zero, 4
ecall
mv   t0, a0
ecall
mv   t1, a0
mv   t2, a0
addi t0, t0, -1
loop:
beq  t0, zero, print
addi a7, zero, 4
ecall
add  t1, t1, a0
blt  a0, t2, skip
mv   t2, a0
skip:
addi t0, t0, -1
j    loop
print:
mv   a0, t1
addi a7, zero, 2
ecall
addi a0, zero, 32
addi a7, zero, 1
ecall
mv   a0, t2
addi a7, zero, 2
ecall
addi a0, zero, 0
addi a7, zero, 0
ecall
