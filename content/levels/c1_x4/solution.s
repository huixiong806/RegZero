# 性能挑战：用 sp 栈计算逆波兰表达式（支持整数与 + - *），ecall 输出结果
li   t0, 0xF0000004
addi t5, zero, 10
addi t6, zero, 32
loop:
lbu  t1, 0(t0)
beq  t1, zero, done
beq  t1, t6, loop
beq  t1, t5, loop
addi t4, t1, -48
bltu t4, t5, parse_num
lw   t3, 0(sp)
lw   t2, 4(sp)
addi sp, sp, 4
addi t4, zero, 43
beq  t1, t4, do_add
addi t4, zero, 45
beq  t1, t4, do_sub
mul  t2, t2, t3
j    store_res
do_add:
add  t2, t2, t3
j    store_res
do_sub:
sub  t2, t2, t3
store_res:
sw   t2, 0(sp)
j    loop
parse_num:
mv   t2, t4
num_loop:
lbu  t1, 0(t0)
addi t4, t1, -48
bgeu t4, t5, push_num
mul  t2, t2, t5
add  t2, t2, t4
j    num_loop
push_num:
addi sp, sp, -4
sw   t2, 0(sp)
bne  t1, zero, loop
done:
lw   a0, 0(sp)
addi a7, zero, 2
ecall
addi a0, zero, 0
addi a7, zero, 0
ecall
